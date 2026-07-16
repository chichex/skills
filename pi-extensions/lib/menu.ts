import {
	DynamicBorder,
	keyHint,
	rawKeyHint,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	type SelectItem,
	SelectList,
	Spacer,
	Text,
} from "@earendil-works/pi-tui";

export interface MenuItem<T extends string = string> {
	value: T;
	label: string;
	description?: string;
	recommended?: boolean;
	danger?: boolean;
}

interface MenuOptions {
	help?: string;
	maxVisible?: number;
	minPrimaryColumnWidth?: number;
	maxPrimaryColumnWidth?: number;
}

export function menuItems<T extends string>(values: readonly T[]): MenuItem<T>[] {
	return values.map((value) => ({ value, label: value }));
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

			const selectItems: SelectItem[] = items.map((item) => {
				let label = item.label;
				if (item.danger) label = theme.fg("error", label);
				if (item.recommended) {
					label += ` ${theme.fg("warning", theme.bold("★ Recomendada"))}`;
				}
				return { value: item.value, label, description: item.description };
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
				selectList.handleInput(data);
				tui.requestRender();
			},
		};
	});
}
