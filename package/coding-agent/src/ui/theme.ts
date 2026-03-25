import { Chalk } from "chalk";
import type { EditorTheme, SelectListTheme } from "@mariozechner/pi-tui";

const chalk = new Chalk({ level: 3 });

export const mypiSelectListTheme: SelectListTheme = {
	selectedPrefix: (text: string) => chalk.cyan(text),
	selectedText: (text: string) => chalk.bold(text),
	description: (text: string) => chalk.dim(text),
	scrollInfo: (text: string) => chalk.dim(text),
	noMatch: (text: string) => chalk.yellow(text),
};

export const mypiEditorTheme: EditorTheme = {
	borderColor: (text: string) => chalk.dim(text),
	selectList: mypiSelectListTheme,
};

export const uiColors = {
	header: (text: string) => chalk.bold.cyan(text),
	muted: (text: string) => chalk.dim(text),
	user: (text: string) => chalk.blue(text),
	assistant: (text: string) => chalk.green(text),
	tool: (text: string) => chalk.magenta(text),
	error: (text: string) => chalk.red(text),
	notice: (text: string) => chalk.yellow(text),
	accent: (text: string) => chalk.cyan(text),
	subtle: (text: string) => chalk.gray(text),
	bold: (text: string) => chalk.bold(text),
	panelBorder: (text: string) => chalk.hex("#6aa9ff")(text),
	selection: (text: string) => chalk.bgHex("#2d3748").white(text),
	current: (text: string) => chalk.cyanBright(text),
};
