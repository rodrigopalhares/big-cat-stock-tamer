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

document.addEventListener('DOMContentLoaded', function () {
    const modal = document.getElementById('csvImportModal');
    if (modal) {
        modal.addEventListener('show.bs.modal', function () {
            const textarea = document.getElementById('csvTextarea');
            if (textarea) textarea.value = '';
            const preview = document.getElementById('csv-preview-area');
            if (preview) preview.innerHTML = '';
            pendingNewAssets = [];
        });
    }
});

function csvNextStep() {
    const table = document.getElementById('csvAssetTable');
    if (!table) return;

    const assets = [];
    const tbody = table.querySelector('tbody');
    const trs = tbody.querySelectorAll('tr');

    trs.forEach(function (tr) {
        const fields = tr.querySelectorAll('.asset-field');
        const row = {};
        fields.forEach(function (field) {
            const key = field.dataset.field;
            row[key] = field.value;
        });
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
