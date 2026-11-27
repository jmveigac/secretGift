try {
    const theme = localStorage.getItem('secretgift-theme');
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {
    // The system theme still works when storage is unavailable.
}
