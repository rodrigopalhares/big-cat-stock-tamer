// True only when the user has manually typed in the price field.
// Auto-derived price (from total) does NOT set this flag.
let priceIsUserSet = false;

function txVals() {
    return {
        qty:   parseFloat(document.getElementById('txQty').value)   || 0,
        price: parseFloat(document.getElementById('txPrice').value) || 0,
        total: parseFloat(document.getElementById('txTotal').value) || 0,
        fees:  parseFloat(document.getElementById('txFees').value)  || 0,
    };
}

function txOnQtyInput() {
    const v = txVals();
    if (v.qty > 0 && v.price > 0) {
        document.getElementById('txTotal').value = (v.qty * v.price + v.fees).toFixed(2);
    }
}

function txOnPriceInput() {
    priceIsUserSet = document.getElementById('txPrice').value !== '';
    const v = txVals();
    if (v.qty > 0 && v.price > 0) {
        document.getElementById('txTotal').value = (v.qty * v.price + v.fees).toFixed(2);
    }
}

function txOnTotalInput() {
    const v = txVals();
    if (v.total > 0 && v.qty > 0) {
        if (priceIsUserSet && v.price > 0) {
            // Price was explicitly typed -> derive fees
            document.getElementById('txFees').value = (v.total - v.qty * v.price).toFixed(2);
        } else {
            // Price is empty or was auto-filled -> derive price (keep flag false)
            document.getElementById('txPrice').value = ((v.total - v.fees) / v.qty).toFixed(4);
        }
    }
}

function txOnFeesInput() {
    const v = txVals();
    if (v.qty > 0 && v.price > 0) {
        document.getElementById('txTotal').value = (v.qty * v.price + v.fees).toFixed(2);
    }
}

// --- CSV Batch Import ---

// Stores new assets collected from the asset review step
let pendingNewAssets = [];
// Stores tickers ignored in the asset review step
let ignoredTickers = new Set();

document.addEventListener('DOMContentLoaded', function () {
    const modal = document.getElementById('csvImportModal');
    if (modal) {
        modal.addEventListener('show.bs.modal', function () {
            const textarea = document.getElementById('csvTextarea');
            if (textarea) textarea.value = '';
            const preview = document.getElementById('csv-preview-area');
            if (preview) preview.innerHTML = '';
            pendingNewAssets = [];
            ignoredTickers = new Set();
        });
    }
});

function onTickerChange(inputElement) {
    const ticker = inputElement.value.trim().toUpperCase();
    inputElement.value = ticker;
    if (ticker.length < 2) return;

    const row = inputElement.closest('tr');
    const spinner = row.querySelector('.ticker-spinner');
    if (spinner) spinner.classList.remove('d-none');

    fetch('/transactions/asset-info?ticker=' + encodeURIComponent(ticker))
        .then(function (response) {
            if (!response.ok) throw new Error('Erro');
            return response.json();
        })
        .then(function (data) {
            const fieldMap = { name: data.name, type: data.type, yfTicker: data.yfTicker, currency: data.currency };
            Object.keys(fieldMap).forEach(function (key) {
                const field = row.querySelector('.asset-field[data-field="' + key + '"]');
                if (field) field.value = fieldMap[key];
            });
            // Update status to WILL_CREATE
            const statusField = row.querySelector('.asset-field[data-field="status"]');
            if (statusField) statusField.value = 'WILL_CREATE';
            const badge = row.querySelector('.badge');
            if (badge) {
                badge.className = 'badge bg-info';
                badge.textContent = 'Novo';
            }
        })
        .catch(function () {
            // Ticker not found online - mark as UNKNOWN
            const statusField = row.querySelector('.asset-field[data-field="status"]');
            if (statusField) statusField.value = 'UNKNOWN';
            const badge = row.querySelector('.badge');
            if (badge) {
                badge.className = 'badge bg-warning text-dark';
                badge.textContent = 'Desconhecido';
            }
        })
        .finally(function () {
            if (spinner) spinner.classList.add('d-none');
        });
}

function onYfTickerChange(inputElement) {
    var yfTicker = inputElement.value.trim();
    if (yfTicker.length < 2) return;

    var row = inputElement.closest('tr');

    fetch('/transactions/asset-info?ticker=' + encodeURIComponent(yfTicker))
        .then(function (response) {
            if (!response.ok) throw new Error('Erro');
            return response.json();
        })
        .then(function (data) {
            var nameField = row.querySelector('.asset-field[data-field="name"]');
            var typeField = row.querySelector('.asset-field[data-field="type"]');
            var currencyField = row.querySelector('.asset-field[data-field="currency"]');
            if (nameField) nameField.value = data.name;
            if (typeField) typeField.value = data.type;
            if (currencyField) currencyField.value = data.currency;
        })
        .catch(function () {});
}

function onAssetIgnoreToggle(checkbox) {
    var row = checkbox.closest('tr');
    if (checkbox.checked) {
        row.classList.add('text-decoration-line-through', 'text-muted');
    } else {
        row.classList.remove('text-decoration-line-through', 'text-muted');
    }
}

function onCsvRowIgnoreToggle(checkbox) {
    var row = checkbox.closest('tr');
    if (checkbox.checked) {
        row.classList.add('text-decoration-line-through', 'text-muted');
    } else {
        row.classList.remove('text-decoration-line-through', 'text-muted');
    }
    updateBatchCount();
}

function updateBatchCount() {
    var table = document.getElementById('csvPreviewTable');
    if (!table) return;
    var total = 0;
    table.querySelectorAll('tbody tr').forEach(function (tr) {
        if (tr.classList.contains('table-danger')) return;
        var check = tr.querySelector('.csv-ignore-check');
        if (!check || !check.checked) total++;
    });
    var countEl = document.getElementById('csvBatchCount');
    var btn = document.getElementById('csvBatchSubmitBtn');
    if (countEl) countEl.textContent = total;
    if (btn) btn.disabled = (total === 0);
}

function csvNextStep() {
    const table = document.getElementById('csvAssetTable');
    if (!table) return;

    const assets = [];
    const tbody = table.querySelector('tbody');
    const trs = tbody.querySelectorAll('tr');
    ignoredTickers = new Set();

    trs.forEach(function (tr) {
        var ignoreCheck = tr.querySelector('.asset-ignore-check');
        const fields = tr.querySelectorAll('.asset-field');
        const row = {};
        fields.forEach(function (field) {
            const key = field.dataset.field;
            row[key] = field.value;
        });
        if (ignoreCheck && ignoreCheck.checked) {
            ignoredTickers.add((row.ticker || '').toUpperCase());
            return;
        }
        if (row.status && row.status !== 'EXISTS') {
            assets.push({
                ticker: row.ticker,
                name: row.name || '',
                type: row.type || 'STOCK',
                yfTicker: row.yfTicker || '',
                currency: row.currency || 'BRL',
            });
        }
    });

    pendingNewAssets = assets;

    const rawCsv = document.getElementById('csvRawHidden');
    if (!rawCsv) return;

    // Replace tickers in raw CSV when user changed them in the review step
    var csvText = rawCsv.value;
    trs.forEach(function (tr) {
        var tickerField = tr.querySelector('.asset-field[data-field="ticker"]');
        if (!tickerField) return;
        var original = (tickerField.dataset.originalTicker || '').toUpperCase();
        var current = (tickerField.value || '').trim().toUpperCase();
        if (original && current && original !== current) {
            csvText = csvText.split('\n').map(function (line) {
                var cols = line.split('\t');
                if (cols[0] && cols[0].trim().toUpperCase() === original) {
                    cols[0] = current;
                    return cols.join('\t');
                }
                return line;
            }).join('\n');
        }
    });
    rawCsv.value = csvText;

    const btn = document.querySelector('#csvAssetTable + * + * button, button[onclick="csvNextStep()"]');
    const spinner = document.getElementById('csv-step2-spinner');
    if (btn) btn.disabled = true;
    if (spinner) spinner.classList.remove('d-none');

    const formData = new FormData();
    formData.append('csv', rawCsv.value);

    fetch('/transactions/parse-csv-step2', {
        method: 'POST',
        body: formData,
    })
        .then(function (response) {
            if (!response.ok) throw new Error('Erro ao processar: ' + response.status);
            return response.text();
        })
        .then(function (html) {
            document.getElementById('csv-preview-area').innerHTML = html;
            // Auto-check ignored tickers from step 1
            if (ignoredTickers.size > 0) {
                document.querySelectorAll('#csvPreviewTable tbody tr').forEach(function (tr) {
                    var check = tr.querySelector('.csv-ignore-check');
                    if (!check) return;
                    var ticker = (check.dataset.ticker || '').toUpperCase();
                    if (ignoredTickers.has(ticker)) {
                        check.checked = true;
                        tr.classList.add('text-decoration-line-through', 'text-muted');
                    }
                });
                updateBatchCount();
            }
        })
        .catch(function (err) {
            document.getElementById('csv-preview-area').innerHTML =
                '<div class="alert alert-danger">' + err.message + '</div>';
        })
        .finally(function () {
            if (btn) btn.disabled = false;
            if (spinner) spinner.classList.add('d-none');
        });
}

function batchSubmit() {
    const table = document.getElementById('csvPreviewTable');
    if (!table) return;

    const rows = [];
    const tbody = table.querySelector('tbody');
    const trs = tbody.querySelectorAll('tr:not(.table-danger)');

    trs.forEach(function (tr) {
        var ignoreCheck = tr.querySelector('.csv-ignore-check');
        if (ignoreCheck && ignoreCheck.checked) return;

        const fields = tr.querySelectorAll('.csv-field:not(:disabled)');
        if (fields.length === 0) return;

        const row = {};
        fields.forEach(function (field) {
            const key = field.dataset.field;
            if (key === 'quantity' || key === 'price' || key === 'fees') {
                row[key] = parseFloat(field.value) || 0;
            } else {
                row[key] = field.value;
            }
        });
        rows.push(row);
    });

    if (rows.length === 0) {
        document.getElementById('csv-preview-area').innerHTML =
            '<div class="alert alert-warning">Nenhuma linha válida para importar.</div>';
        return;
    }

    const payload = { rows: rows };
    if (pendingNewAssets.length > 0) {
        payload.assets = pendingNewAssets;
    }

    fetch('/transactions/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    })
        .then(function (response) {
            if (!response.ok) throw new Error('Erro ao importar: ' + response.status);
            return response.json();
        })
        .then(function (data) {
            location.href = '/transactions/';
        })
        .catch(function (err) {
            document.getElementById('csv-preview-area').innerHTML =
                '<div class="alert alert-danger">' + err.message + '</div>';
        });
}
