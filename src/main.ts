import {
	App,
	debounce,
	FileView,
	IconName,
	Menu,
	Modal,
	Platform,
	setIcon,
	Setting,
	setTooltip,
	TFile,
} from "obsidian";
import {
	getFileChildrenIndexes,
	getFileParentIndexes,
	removeFtag,
} from "../obsidian-reusables/src/ftags";
import uniq from "lodash-es/uniq";
import prettyBytes from "pretty-bytes";
import PluginWithSettings from "../obsidian-reusables/src/PluginWithSettings";
import { DEFAULT_SETTINGS } from "./settings";
import { MainPluginSettingsTab } from "./settings";

export default class StaticTagChipsPlugin extends PluginWithSettings(
	DEFAULT_SETTINGS,
) {
	override async onload() {
		await this.initSettings(MainPluginSettingsTab);
		this.injectChips();

		const debouncedInjectChips = debounce(
			() => {
				this.injectChips();
			},
			50,
			true,
		);

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this.injectChips();
			}),
		);

		this.registerEvent(
			this.app.vault.on("rename", () => {
				this.injectChips();
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", () => {
				this.injectChips();
			}),
		);
		this.registerEvent(
			this.app.vault.on("create", (file) => {
				// TODO: fix so that it works when a parent of any opened file is changed, not just active one
				if (file.parent === this.app.workspace.getActiveFile()?.parent)
					this.injectChips();
			}),
		);

		this.registerEvent(
			this.app.metadataCache.on("changed", () => {
				this.injectChips();
			}),
		);
		this.registerEvent(
			this.app.metadataCache.on("resolve", () => {
				debouncedInjectChips();
			}),
		);
	}

	injectChildren(activeView: FileView) {
		if (!("file" in activeView && activeView.file instanceof TFile)) return;
		const currentFile = activeView.file;

		const header = activeView.containerEl.querySelector(".view-header");
		if (!header) return;

		const existing = activeView.containerEl.querySelector(
			".ftags-children-outer",
		);
		if (existing) existing.remove();

		const outer = header.createDiv({
			cls: "ftags-children-outer",
		});
		const inner = outer.createDiv({
			cls: "ftags-children",
		});
		const tags = activeView.containerEl.querySelector(
			".static-tag-chips-container-outer",
		);
		tags?.insertAdjacentElement("afterend", outer);
		const regexes: (RegExp | string)[] =
			(
				this.app.vault.getConfig("userIgnoreFilters") as
					| string[]
					| undefined
			)?.map((v: string) =>
				v.startsWith("/") && v.endsWith("/")
					? new RegExp(v.slice(1, -1))
					: v,
			) ?? [];
		const children = getFileChildrenIndexes(currentFile, this.app).filter(
			(c) =>
				!regexes.some((r) =>
					typeof r === "string"
						? c.path.startsWith(r)
						: r.exec(c.path),
				),
		);
		for (const child of children.slice(0, 5)) {
			inner.appendChild(this.createChildItem(child, currentFile));
		}
		if (children.length > 5) {
			const c = createTreeItem("/", "...", "folder");
			inner.appendChild(c);
			c.addEventListener("click", () => {
				this.app.commands.executeCommandById(
					"file-explorer:reveal-active-file",
				);
			});
		}
	}

	createChildItem(file: TFile, source: TFile) {
		const extToIcon: Record<string, IconName> = Object.fromEntries(
			Object.entries({ image: ["jpg", "png"] }).flatMap(([icon, exts]) =>
				exts.map((e) => [e, icon]),
			),
		);
		const isIndex = file.parent?.name === file.basename;
		const item = createTreeItem(
			file.path,
			file.basename,
			isIndex ? "folder" : (extToIcon[file.extension] ?? "file"),
		);
		this.addFileElHandlers(item, file, source);

		return item;
	}

	addFileElHandlers(item: HTMLElement, file: TFile, source: TFile) {
		item.addEventListener("mouseenter", (e) => {
			this.highlightFileEntry(
				file.basename === file.parent?.name
					? file.parent.path
					: file.path,
			);
			if (e.ctrlKey) {
				this.app.workspace.trigger("hover-link", {
					event: e,
					source: source,
					hoverParent: item.parentElement,
					targetEl: item,
					linktext: file.path,
				});
			}
		});
		setTooltip(
			item,
			`${file.name}\n\nLast modified at ${window
				.moment(file.stat.mtime)
				.format("YYYY-MM-DD HH:mm")}\nCreated at ${window
				.moment(file.stat.ctime)
				.format("YYYY-MM-DD HH:mm")}\nSize ${prettyBytes(
				file.stat.size,
			)}`,
		);
		item.addEventListener("mouseleave", () => {
			this.removeHighlightFileEntry();
		});
		const open = () => this.app.workspace.getLeaf().openFile(file);
		const openToTheRight = () =>
			this.app.workspace.getLeaf("split").openFile(file);
		const openInNewTab = () =>
			this.app.workspace.getLeaf("tab").openFile(file);
		const showMenu = (e: { pageX: number; pageY: number }) => {
			const menu = new Menu();
			menu.addItem((e) =>
				e
					.setSection("open")
					.setTitle("Open child")
					.setIcon("lucide-file")
					.onClick(() => open()),
			);

			menu.addItem((e) =>
				e
					.setSection("open")
					.setTitle("Open in new tab")
					.setIcon("lucide-file-plus")
					.onClick(() => openInNewTab()),
			);

			if (Platform.isDesktop) {
				menu.addItem((e) =>
					e
						.setSection("open")
						.setTitle("Open to the right")
						.setIcon("lucide-separator-vertical")
						.onClick(() => openToTheRight()),
				);
			}

			menu.addItem((e) =>
				e
					.setSection("action")
					.setTitle("Rename")
					.setIcon("lucide-edit-3")
					.onClick(() =>
						this.app.fileManager.promptForFileRename(file),
					),
			);
			menu.addItem((e) =>
				e
					.setSection("danger")
					.setTitle("Remove")
					.setWarning(true)
					.setIcon("lucide-trash-2")
					.onClick(() =>
						this.app.fileManager.promptForDeletion(file),
					),
			);
			this.app.workspace.trigger("file-menu", menu, file, source);
			menu.showAtPosition({ x: e.pageX, y: e.pageY });
		};
		item.addEventListener("contextmenu", (e) => {
			showMenu(e);
		});
		item.addEventListener("click", (e) => {
			if (e.ctrlKey) {
				if (e.altKey) {
					void openToTheRight();
				} else {
					void openInNewTab();
				}
			} else void open();
			this.removeHighlightFileEntry();
		});
	}

	injectChips() {
		this.app.workspace.iterateAllLeaves((leaf) => {
			const activeView = leaf.view;
			if (
				![
					"markdown",
					"audio",
					"pdf",
					"image",
					"canvas",
					"dirview",
				].includes(activeView.getViewType()) ||
				!(activeView instanceof FileView)
			)
				return;
			this.injectTags(activeView);
			this.injectChildren(activeView);
		});
	}

	injectTags(activeView: FileView) {
		if (!("file" in activeView && activeView.file instanceof TFile)) return;
		const currentFile = activeView.file;

		const header = activeView.containerEl.querySelector(".view-header");
		if (!header) return;

		const existing = activeView.containerEl.querySelector(
			".static-tag-chips-container-outer",
		);
		if (existing) existing.remove();

		const outer = header.createDiv({
			cls: "static-tag-chips-container-outer",
		});
		const chipContainer = outer.createDiv({
			cls: "static-tag-chips-container",
		});
		header.insertAdjacentElement("afterend", outer);

		const parents = getFileParentIndexes(currentFile, this.app);
		const addChip = (
			parent: TFile,
			layer: "first" | "second" | "third" | "fourth",
			toplevel?: boolean,
		) => {
			const chip = chipContainer.createSpan({
				cls: "cm-hashtag cm-hashtag-end cm-hashtag-begin",
			});
			chip.classList.add(`viewer-ftag-tag-chip-layer-${layer}`);
			this.addFileElHandlers(chip, parent, currentFile);
			chip.setText("#" + parent.basename);
			if (!toplevel) return;
			const remove = chip.createSpan();
			setIcon(remove, "x");
			remove.addEventListener("click", (e) => {
				e.stopPropagation();

				if (!this.app.vault.getFolderByPath(this.settings.inbox))
					new Notice(
						`You should create your inbox folder (${this.settings.inbox}) to be able to delete last ftag (if the last ftag is the inbox you won't be able to delete it too)`,
					);

				new ConfirmationModal(
					this.app,
					() => {
						void removeFtag(
							parent,
							currentFile,
							this.app,
							this.app.vault.getFolderByPath(
								this.settings.inbox,
							) ?? undefined,
						);
					},
					parent,
				).open();
			});
		};
		if (this.app.plugins.plugins["crosslink-advanced"]) {
			const createButton = chipContainer.createSpan({
				cls: "cm-hashtag cm-hashtag-end cm-hashtag-begin",
			});
			createButton.setText("+ Add tag...");
			createButton.addEventListener("click", () => {
				this.app.commands.executeCommandById(
					"crosslink-advanced:add-ftag",
				);
			});
		}

		const visited = new Set(parents.map((v) => v.path));
		const getNext = (p: typeof parents) =>
			uniq(
				p
					.filter((v) => !v.path.startsWith(this.settings.inbox))
					.flatMap((v) => getFileParentIndexes(v, this.app)),
			)
				.filter((v) => !visited.has(v.path))
				.map((v) => (visited.add(v.path), v));
		const next = getNext(parents);
		for (const parent of parents) {
			addChip(parent, "first", true);
		}
		for (const nextParent of next) {
			addChip(nextParent, "second");
		}
		const nextnext = getNext(next);
		for (const nextParent of nextnext) {
			addChip(nextParent, "third");
		}
		for (const nextParent of getNext(nextnext)) {
			addChip(nextParent, "fourth");
		}
	}

	highlightFileEntry(filePath: string) {
		const entries = document.querySelectorAll(`[data-path="${filePath}"]`);
		entries.forEach((entry) => {
			if (!entry.classList.contains("is-active"))
				entry.classList.add(
					"is-active",
					"is-highlighted-via-viewer-ftags",
				);
		});
	}

	removeHighlightFileEntry() {
		const entries = document.querySelectorAll(
			`.is-highlighted-via-viewer-ftags`,
		);
		entries.forEach((entry) => {
			entry.classList.remove(
				"is-active",
				"is-highlighted-via-viewer-ftags",
			);
		});
	}
	override onunload() {
		this.app.workspace.iterateAllLeaves((leaf) => {
			leaf.view.containerEl
				.querySelector(".static-tag-chips-container-outer")
				?.remove();
			leaf.view.containerEl
				.querySelector(".ftags-children-outer")
				?.remove();
		});
	}
}

export class ConfirmationModal extends Modal {
	constructor(app: App, onSubmit: () => void, ftag: TFile) {
		super(app);
		this.setTitle("Do you want to untag?");

		this.setContent(
			`Are you sure you want to remove this tag: ${ftag.basename}`,
		);

		const set = new Setting(this.contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Delete")
					.setWarning()
					.setCta()
					.onClick(() => {
						this.close();
						onSubmit();
					}),
			)
			.addButton((btn) =>
				btn
					.setButtonText("Cancel")
					.setCta()
					.onClick(() => {
						this.close();
					}),
			);
		set.settingEl.classList.add("viewer-ftags-custom-setting-el");
	}
}
function createTreeItem(
	path: string,
	label: string,
	customIcon: string,
): HTMLElement {
	const treeItem = createEl("div", {
		cls: "tree-item",
		attr: { "data-path": path },
	});
	const treeItemSelf = createDiv({
		cls: "tree-item-self viewer-ftags-custom-tree-item bookmark is-clickable is-active",
		attr: {
			draggable: "true",
		},
	});
	treeItem.appendChild(treeItemSelf);
	const treeItemIcon = createEl("div", { cls: "tree-item-icon" });
	treeItemSelf.appendChild(treeItemIcon);
	const treeItemInner = createEl("div", { cls: "tree-item-inner" });
	treeItemSelf.appendChild(treeItemInner);
	setIcon(treeItemIcon, customIcon);

	const treeItemText = createEl("span", {
		cls: "tree-item-inner-text",
		text: label,
	});
	treeItemInner.appendChild(treeItemIcon);
	treeItemInner.appendChild(treeItemText);
	return treeItem;
}
