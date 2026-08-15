import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8').replace(/\r\n?/g, '\n');
}

describe('phase13 ProjectChat mobile shell', () => {
  it('uses the full mobile conversation width for both user and AI messages', () => {
    const css = read('src/pages/ProjectChat/ProjectChat.css');
    const mobileCss = css.slice(css.indexOf('@media (max-width: 900px)'));

    expect(mobileCss).toMatch(
      /\.project-chat-message\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;/su,
    );
  });

  it('joins the project header and chat controls into one mobile surface', () => {
    const shell = read('src/components/mobile/MobileProjectShell.jsx');
    const shellCss = read('src/components/mobile/MobileProjectShell.css');
    const chat = read('src/pages/ProjectChat/ProjectChat.jsx');
    const chatCss = read('src/pages/ProjectChat/ProjectChat.css');

    expect(shell).toContain("const isChatRoute = location.pathname.includes('/chat');");
    expect(shell).toContain('project-mobile-shell--chat');
    expect(shellCss).toMatch(
      /\.project-mobile-shell--chat \.project-mobile-topbar\s*\{[^}]*border-bottom:\s*0;/su,
    );
    expect(shellCss).toMatch(
      /\.project-mobile-shell--chat \.project-mobile-content\s*\{[^}]*overflow:\s*hidden;/su,
    );
    expect(chat).toContain('project-chat-topbar__status');
    expect(chatCss).toMatch(
      /\.project-chat-topbar__status\s*>\s*span\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/su,
    );
  });

  it('closes mobile history before creating a thread and never focuses the hidden composer', () => {
    const chat = read('src/pages/ProjectChat/ProjectChat.jsx');

    expect(chat).toContain('focusComposer = !isMobileLayout');
    expect(chat).toContain('if (activate && focusComposer)');
    expect(chat).toContain('setMobileThreadsOpen(false);');
    expect(chat).toContain('focusComposer: false');
  });

  it('uses one mobile viewport owner and removes expensive blur while the keyboard resizes chat', () => {
    const viewport = read('index.html');
    const appLayoutCss = read('src/components/common/AppLayout.css');
    const chatCss = read('src/pages/ProjectChat/ProjectChat.css');

    expect(viewport).toContain('viewport-fit=cover');
    expect(viewport).toContain('interactive-widget=resizes-content');
    expect(appLayoutCss).toMatch(
      /\.app-layout--mobile \.app-main\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;/su,
    );
    expect(chatCss).toMatch(
      /@media \(max-width: 900px\)[\s\S]*\.project-chat-composer\s*\{[^}]*backdrop-filter:\s*none;/su,
    );
  });
});
