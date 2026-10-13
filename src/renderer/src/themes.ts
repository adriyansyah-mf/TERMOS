import type { ITheme } from '@xterm/xterm'

export const THEMES: Record<string, { label: string; theme: ITheme }> = {
  'termos-dark': {
    label: 'Termos Dark',
    theme: {
      background: '#0b0d12',
      foreground: '#d8dee9',
      cursor: '#5b8cff',
      cursorAccent: '#0b0d12',
      selectionBackground: '#2c3d6b',
      black: '#1d212d',
      red: '#f2616b',
      green: '#3ccf91',
      yellow: '#f2b84b',
      blue: '#5b8cff',
      magenta: '#b07cff',
      cyan: '#36b3d6',
      white: '#d8dee9',
      brightBlack: '#5b6478',
      brightRed: '#ff7f88',
      brightGreen: '#6ee6b0',
      brightYellow: '#ffd37a',
      brightBlue: '#86a9ff',
      brightMagenta: '#c9a3ff',
      brightCyan: '#6fd3ef',
      brightWhite: '#ffffff'
    }
  },
  dracula: {
    label: 'Dracula',
    theme: {
      background: '#282a36',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      selectionBackground: '#44475a',
      black: '#21222c',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#bd93f9',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      white: '#f8f8f2',
      brightBlack: '#6272a4',
      brightRed: '#ff6e6e',
      brightGreen: '#69ff94',
      brightYellow: '#ffffa5',
      brightBlue: '#d6acff',
      brightMagenta: '#ff92df',
      brightCyan: '#a4ffff',
      brightWhite: '#ffffff'
    }
  },
  'solarized-dark': {
    label: 'Solarized Dark',
    theme: {
      background: '#002b36',
      foreground: '#839496',
      cursor: '#93a1a1',
      selectionBackground: '#073642',
      black: '#073642',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#eee8d5',
      brightBlack: '#586e75',
      brightRed: '#cb4b16',
      brightGreen: '#93a1a1',
      brightYellow: '#839496',
      brightBlue: '#657b83',
      brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1',
      brightWhite: '#fdf6e3'
    }
  },
  'one-light': {
    label: 'One Light',
    theme: {
      background: '#fafafa',
      foreground: '#383a42',
      cursor: '#526eff',
      selectionBackground: '#d4dcf5',
      black: '#383a42',
      red: '#e45649',
      green: '#50a14f',
      yellow: '#c18401',
      blue: '#4078f2',
      magenta: '#a626a4',
      cyan: '#0184bc',
      white: '#a0a1a7',
      brightBlack: '#696c77',
      brightRed: '#e06c75',
      brightGreen: '#98c379',
      brightYellow: '#d19a66',
      brightBlue: '#61afef',
      brightMagenta: '#c678dd',
      brightCyan: '#56b6c2',
      brightWhite: '#ffffff'
    }
  }
}

export function themeFor(name?: string): ITheme {
  return (THEMES[name ?? ''] ?? THEMES['termos-dark']).theme
}
