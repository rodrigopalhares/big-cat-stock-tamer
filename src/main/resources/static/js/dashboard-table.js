document.addEventListener('DOMContentLoaded', function () {
    var table = document.getElementById('positionsTable');
    if (!table) return;

    var filterType = document.getElementById('filterType');
    var filterPosition = document.getElementById('filterPosition');
    var thead = table.querySelector('thead');
    var tbody = table.querySelector('tbody');
    var currentSort = { col: -1, asc: true };

    function filterTable() {
        var type = filterType.value;
        var onlyWithPosition = filterPosition.checked;
        var rows = tbody.querySelectorAll('tr');
        rows.forEach(function (row) {
            var rowType = row.getAttribute('data-type') || '';
            var qty = parseFloat(row.getAttribute('data-quantity') || '0');
            var showType = !type || rowType === type;
            var showQty = !onlyWithPosition || qty > 0;
            row.style.display = (showType && showQty) ? '' : 'none';
        });
    }

    filterType.addEventListener('change', filterTable);
    filterPosition.addEventListener('change', filterTable);

    // Run initial filter (checkbox is checked by default)
    filterTable();

    // Sortable headers
    var headers = thead.querySelectorAll('th[data-sort]');
    headers.forEach(function (th, idx) {
        th.style.cursor = 'pointer';
        th.style.userSelect = 'none';
        th.addEventListener('click', function () {
            var colIdx = th.cellIndex;
            var sortType = th.getAttribute('data-sort');
            var asc = (currentSort.col === colIdx) ? !currentSort.asc : true;
            currentSort = { col: colIdx, asc: asc };

            // Update indicators
            headers.forEach(function (h) {
                var arrow = h.querySelector('.sort-arrow');
                if (arrow) arrow.textContent = '';
            });
            var arrow = th.querySelector('.sort-arrow');
            if (arrow) arrow.textContent = asc ? ' \u2191' : ' \u2193';

            var rows = Array.from(tbody.querySelectorAll('tr'));
            rows.sort(function (a, b) {
                var aVal = getCellValue(a, colIdx, sortType);
                var bVal = getCellValue(b, colIdx, sortType);
                if (sortType === 'num') {
                    return asc ? (aVal - bVal) : (bVal - aVal);
                }
                return asc ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal));
            });
            rows.forEach(function (row) { tbody.appendChild(row); });
        });
    });

    function getCellValue(row, colIdx, sortType) {
        var cell = row.cells[colIdx];
        if (!cell) return sortType === 'num' ? 0 : '';
        var text = cell.textContent.trim();
        if (sortType === 'num') {
            // Remove currency symbols, spaces, % and parse
            var cleaned = text.replace(/[R$US$%\s\u2248\u2014]/g, '').replace(/\./g, '').replace(',', '.');
            var val = parseFloat(cleaned);
            return isNaN(val) ? -Infinity : val;
        }
        return text;
    }
});
