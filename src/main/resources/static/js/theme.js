function toggleTheme() {
    var current = document.documentElement.dataset.bsTheme;
    var next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.bsTheme = next;
    localStorage.setItem('theme', next);
    updateThemeIcon(next);
}

function updateThemeIcon(theme) {
    var icon = document.querySelector('#themeToggle i');
    if (icon) {
        icon.className = theme === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-fill';
    }
}

document.addEventListener('DOMContentLoaded', function() {
    updateThemeIcon(document.documentElement.dataset.bsTheme);
});
