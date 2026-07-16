import {
  createEditToolDefinition,
  type EditToolDetails,
  type ExtensionAPI,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Text,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

const DIFF_INDENT = "    ";
const ADDED_BG = "\x1b[48;2;18;66;24m";
const REMOVED_BG = "\x1b[48;2;91;24;20m";
const RESET_BG = "\x1b[49m";

interface ParsedDiffLine {
  kind: "added" | "removed" | "context";
  prefix: string;
  content: string;
}

function compactPath(path: string, cwd: string): string {
  const absolutePath = isAbsolute(path) ? path : resolve(cwd, path);
  const home = homedir();
  if (absolutePath === home) return "~";
  if (absolutePath.startsWith(`${home}/`)) return `~/${absolutePath.slice(home.length + 1)}`;
  return absolutePath;
}

function parseDiffLine(line: string): ParsedDiffLine {
  const match = line.match(/^([+\- ])(\s*\d*)\s(.*)$/);
  if (!match) return { kind: "context", prefix: "   ", content: line };

  const marker = match[1];
  const lineNumber = match[2];
  return {
    kind: marker === "+" ? "added" : marker === "-" ? "removed" : "context",
    prefix: `${marker}${lineNumber} `,
    content: match[3].replace(/\t/g, "   "),
  };
}

function rawBackground(color: string, text: string): string {
  return `${color}${text}${RESET_BG}`;
}

class ClaudeDiffComponent implements Component {
  constructor(
    private diff: string | undefined,
    private error: string | undefined,
    private theme: Theme,
  ) {}

  update(diff: string | undefined, error: string | undefined, theme: Theme): void {
    this.diff = diff;
    this.error = error;
    this.theme = theme;
  }

  render(width: number): string[] {
    if (width <= 0) return [];

    if (this.error) {
      return [
        truncateToWidth(
          `  ${this.theme.fg("error", "└ Error: ")}${this.theme.fg("muted", this.error)}`,
          width,
        ),
      ];
    }

    if (!this.diff) return [];

    const parsed = this.diff.split("\n").map(parseDiffLine);
    const added = parsed.filter((line) => line.kind === "added").length;
    const removed = parsed.filter((line) => line.kind === "removed").length;
    const summary =
      `  ${this.theme.fg("dim", "└ Added ")}` +
      `${this.theme.bold(String(added))}${this.theme.fg("dim", ` ${added === 1 ? "line" : "lines"}, removed `)}` +
      `${this.theme.bold(String(removed))}${this.theme.fg("dim", ` ${removed === 1 ? "line" : "lines"}`)}`;

    const lines = [truncateToWidth(summary, width)];
    const rowWidth = Math.max(1, width - visibleWidth(DIFF_INDENT));

    for (const line of parsed) {
      const prefixWidth = Math.min(visibleWidth(line.prefix), rowWidth);
      const contentWidth = Math.max(1, rowWidth - prefixWidth);
      const wrapped = wrapTextWithAnsi(line.content, contentWidth);
      const chunks = wrapped.length > 0 ? wrapped : [""];

      for (let index = 0; index < chunks.length; index++) {
        const prefix = index === 0 ? truncateToWidth(line.prefix, prefixWidth, "") : " ".repeat(prefixWidth);
        const chunk = truncateToWidth(chunks[index], contentWidth, "");

        if (line.kind === "context") {
          const contextLine = `${prefix}${chunk}`;
          lines.push(
            truncateToWidth(
              `${DIFF_INDENT}${this.theme.fg("toolDiffContext", contextLine)}`,
              width,
            ),
          );
          continue;
        }

        const token = line.kind === "added" ? "toolDiffAdded" : "toolDiffRemoved";
        const background = line.kind === "added" ? ADDED_BG : REMOVED_BG;
        const styledPrefix = this.theme.fg(token, prefix);
        const styledContent = this.theme.fg("text", chunk);
        const used = visibleWidth(prefix) + visibleWidth(chunk);
        const padding = " ".repeat(Math.max(0, rowWidth - used));
        lines.push(`${DIFF_INDENT}${rawBackground(background, `${styledPrefix}${styledContent}${padding}`)}`);
      }
    }

    return lines;
  }

  invalidate(): void {
    // Rendering is stateless, so theme changes are picked up on the next render.
  }
}

function textOutput(content: Array<{ type: string; text?: string }>): string | undefined {
  const output = content
    .filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .filter(Boolean)
    .join("\n");
  return output || undefined;
}

export default function (pi: ExtensionAPI) {
  const nativeEdit = createEditToolDefinition(process.cwd());

  pi.registerTool({
    ...nativeEdit,
    renderShell: "self",

    renderCall(args, theme, context) {
      const path = args.path ? compactPath(args.path, context.cwd) : "…";
      const statusColor = context.isError ? "error" : context.isPartial ? "dim" : "success";
      const header =
        `${theme.fg(statusColor, "●")} ` +
        `${theme.fg("toolTitle", theme.bold("Update"))}` +
        `${theme.fg("muted", "(")}${theme.fg("text", path)}${theme.fg("muted", ")")}`;

      const component = context.lastComponent instanceof Text
        ? context.lastComponent
        : new Text("", 0, 0);
      component.setText(header);
      return component;
    },

    renderResult(result, _options, theme, context) {
      const details = result.details as EditToolDetails | undefined;
      const error = context.isError ? textOutput(result.content) : undefined;
      const component = context.lastComponent instanceof ClaudeDiffComponent
        ? context.lastComponent
        : new ClaudeDiffComponent(details?.diff, error, theme);
      component.update(details?.diff, error, theme);
      return component;
    },
  });
}
