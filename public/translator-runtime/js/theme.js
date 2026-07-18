const STORYFORGE_THEME_IDS = new Set(['dark', 'light', 'cream']);
const STORYFORGE_THEME_COLORS = {
    dark: '#0a0a0f',
    light: '#f8fafc',
    cream: '#f7f5f0',
};

function normalizeStoryForgeTheme(value) {
    return STORYFORGE_THEME_IDS.has(value) ? value : 'dark';
}

function applyStoryForgeTheme(value) {
    const theme = normalizeStoryForgeTheme(value);
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = STORYFORGE_THEME_COLORS[theme];
    return theme;
}

function readStoredStoryForgeTheme() {
    try {
        return normalizeStoryForgeTheme(localStorage.getItem('sf-theme'));
    } catch {
        return 'dark';
    }
}

applyStoryForgeTheme(readStoredStoryForgeTheme());

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('message', (event) => {
        if (event.origin !== window.location.origin) return;
        if (window.parent && window.parent !== window && event.source !== window.parent) return;
        if (event.data?.type !== 'STORYFORGE_THEME_CONTEXT') return;
        applyStoryForgeTheme(event.data.theme);
    });
}
