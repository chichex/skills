import {
	DynamicBorder,
	keyHint,
	rawKeyHint,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";
import {
	Container,
	type SelectItem,
	matchesKey,
	SelectList,
	Spacer,
	Text,
} from "@earendil-works/pi-tui";

export interface MenuItem<T extends string = string> {
	value: T;
	label: string;
	description?: string;
	recommended?: boolean;
	success?: boolean;
	danger?: boolean;
	multiSelectable?: boolean;
	shortcut?: KeyId;
	separatorBefore?: boolean;
}

interface MenuOptions {
	help?: string;
	maxVisible?: number;
	maxSelected?: number;
	initialSelectedValues?: readonly string[];
	minPrimaryColumnWidth?: number;
	maxPrimaryColumnWidth?: number;
}

export function menuItems<T extends string>(values: readonly T[]): MenuItem<T>[] {
	return values.map((value) => ({ value, label: value }));
}

function themedLabel<T extends string>(
	item: MenuItem<T>,
	theme: ExtensionContext["ui"]["theme"],
): string {
	let label = item.label;
	if (item.success) label = theme.fg("success", label);
	if (item.danger) label = theme.fg("error", label);
	if (item.separatorBefore) label = `${theme.fg("borderMuted", "────────")}  ${label}`;
	if (item.recommended) {
		label += ` ${theme.fg("warning", theme.bold("★ Recomendada"))}`;
	}
	return label;
}

/**
 * Shared selector used by the global extensions.
 * Keeps borders structural, titles prominent, and the current row visible via
 * background as well as color. RPC falls back to Pi's native selector.
 */
export async function selectMenu<T extends string>(
	ctx: ExtensionContext,
	title: string,
	items: readonly MenuItem<T>[],
	options: MenuOptions = {},
): Promise<T | null> {
	if (items.length === 0) return null;

	if (ctx.mode !== "tui") {
		const labels = items.map((item) => item.label);
		const selected = await ctx.ui.select(title, labels);
		return items.find((item) => item.label === selected)?.value ?? null;
	}

	return ctx.ui.custom<T | null>((tui, theme, _keybindings, done) => {
		let container = new Container();
		let selectList: SelectList;
		let selectedValue: T | undefined = items[0]?.value;

		const rebuild = (): void => {
			container = new Container();
			container.addChild(new DynamicBorder((text: string) => theme.fg("borderMuted", text)));
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
			container.addChild(new Spacer(1));

			const selectItems: SelectItem[] = items.map((item) => ({
				value: item.value,
				label: themedLabel(item, theme),
				description: item.description,
			}));
			selectList = new SelectList(
				selectItems,
				Math.min(items.length, options.maxVisible ?? 12),
				{
					selectedPrefix: (text) => theme.fg("accent", text),
					selectedText: (text) => theme.bg("selectedBg", theme.fg("text", text)),
					description: (text) => theme.fg("muted", text),
					scrollInfo: (text) => theme.fg("dim", text),
					noMatch: (text) => theme.fg("warning", text),
				},
				{
					minPrimaryColumnWidth: options.minPrimaryColumnWidth,
					maxPrimaryColumnWidth: options.maxPrimaryColumnWidth,
				},
			);
			const selectedIndex = items.findIndex((item) => item.value === selectedValue);
			selectList.setSelectedIndex(selectedIndex >= 0 ? selectedIndex : 0);
			selectList.onSelectionChange = (item) => {
				selectedValue = item.value as T;
			};
			selectList.onSelect = (item) => done(item.value as T);
			selectList.onCancel = () => done(null);
			container.addChild(selectList);
			container.addChild(new Spacer(1));

			const help = options.help ?? [
				rawKeyHint("↑↓", "navegar"),
				keyHint("tui.select.confirm", "elegir"),
				keyHint("tui.select.cancel", "cancelar"),
			].join("  ");
			container.addChild(new Text(help, 1, 0));
			container.addChild(new Spacer(1));
			container.addChild(new DynamicBorder((text: string) => theme.fg("borderMuted", text)));
		};

		rebuild();
		return {
			render: (width: number) => container.render(width),
			invalidate: () => {
				selectedValue = selectList.getSelectedItem()?.value as T | undefined;
				rebuild();
			},
			handleInput: (data: string) => {
				const shortcutItem = items.find((item) => item.shortcut && matchesKey(data, item.shortcut));
				if (shortcutItem) done(shortcutItem.value);
				else selectList.handleInput(data);
				tui.requestRender();
			},
		};
	});
}

/**
 * Multi-selector variant. Space toggles rows and Enter confirms all checked
 * rows. With nothing checked, Enter preserves the familiar single-select flow
 * by returning the highlighted row.
 */
export async function selectManyMenu<T extends string>(
	ctx: ExtensionContext,
	title: string,
	items: readonly MenuItem<T>[],
	options: MenuOptions = {},
): Promise<T[] | null> {
	if (items.length === 0) return [];

	if (ctx.mode !== "tui") {
		const selected = await selectMenu(ctx, title, items, options);
		return selected === null ? null : [selected];
	}

	return ctx.ui.custom<T[] | null>((tui, theme, _keybindings, done) => {
		let container = new Container();
		let selectList: SelectList;
		const initialValues = new Set(options.initialSelectedValues ?? []);
		const selectedValues = new Set<T>(items
			.filter((item) => item.multiSelectable !== false && initialValues.has(item.value))
			.map((item) => item.value));
		let currentValue: T | undefined = items.find((item) => selectedValues.has(item.value))?.value ?? items[0]?.value;

		const orderedSelection = (): T[] => items
			.filter((item) => selectedValues.has(item.value))
			.map((item) => item.value);

		const rebuild = (): void => {
			container = new Container();
			container.addChild(new DynamicBorder((text: string) => theme.fg("borderMuted", text)));
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
			container.addChild(new Spacer(1));

			const selectItems: SelectItem[] = items.map((item) => {
				const canToggle = item.multiSelectable !== false;
				const checked = selectedValues.has(item.value);
				const checkbox = canToggle
					? checked ? theme.fg("success", "[✓]") : theme.fg("dim", "[ ]")
					: "   ";
				return {
					value: item.value,
					label: `${checkbox} ${themedLabel(item, theme)}`,
					description: item.description,
				};
			});
			selectList = new SelectList(
				selectItems,
				Math.min(items.length, options.maxVisible ?? 12),
				{
					selectedPrefix: (text) => theme.fg("accent", text),
					selectedText: (text) => theme.bg("selectedBg", theme.fg("text", text)),
					description: (text) => theme.fg("muted", text),
					scrollInfo: (text) => theme.fg("dim", text),
					noMatch: (text) => theme.fg("warning", text),
				},
				{
					minPrimaryColumnWidth: options.minPrimaryColumnWidth,
					maxPrimaryColumnWidth: options.maxPrimaryColumnWidth,
				},
			);
			const selectedIndex = items.findIndex((item) => item.value === currentValue);
			selectList.setSelectedIndex(selectedIndex >= 0 ? selectedIndex : 0);
			selectList.onSelectionChange = (item) => {
				currentValue = item.value as T;
			};
			selectList.onSelect = (selectedItem) => {
				const item = items.find((candidate) => candidate.value === selectedItem.value);
				if (item?.multiSelectable === false) {
					done([item.value]);
					return;
				}
				const selected = orderedSelection();
				done(selected.length > 0 ? selected : [selectedItem.value as T]);
			};
			selectList.onCancel = () => done(null);
			container.addChild(selectList);
			container.addChild(new Spacer(1));

			const help = options.help ?? [
				rawKeyHint("↑↓", "navegar"),
				rawKeyHint("space", "marcar"),
				keyHint("tui.select.confirm", "confirmar"),
				keyHint("tui.select.cancel", "cancelar"),
			].join("  ");
			container.addChild(new Text(help, 1, 0));
			const selectionLimit = options.maxSelected ? `/${options.maxSelected}` : "";
			const selectionStatus = selectedValues.size > 0
				? `Marcados: ${selectedValues.size}${selectionLimit}. Enter confirma la selección.`
				: "Sin marcas, Enter abre solo el issue actual.";
			const statusColor = options.maxSelected && selectedValues.size >= options.maxSelected ? "warning" : "dim";
			container.addChild(new Text(theme.fg(statusColor, selectionStatus), 1, 0));
			container.addChild(new Spacer(1));
			container.addChild(new DynamicBorder((text: string) => theme.fg("borderMuted", text)));
		};

		rebuild();
		return {
			render: (width: number) => container.render(width),
			invalidate: () => {
				currentValue = selectList.getSelectedItem()?.value as T | undefined;
				rebuild();
			},
			handleInput: (data: string) => {
				if (matchesKey(data, "space")) {
					const selected = selectList.getSelectedItem();
					const item = items.find((candidate) => candidate.value === selected?.value);
					if (item?.multiSelectable !== false) {
						currentValue = item?.value;
						if (item && selectedValues.has(item.value)) selectedValues.delete(item.value);
						else if (item && (!options.maxSelected || selectedValues.size < options.maxSelected)) {
							selectedValues.add(item.value);
						}
						rebuild();
					}
				} else {
					selectList.handleInput(data);
				}
				tui.requestRender();
			},
		};
	});
}
