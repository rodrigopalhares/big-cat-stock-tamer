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

document.addEventListener('DOMContentLoaded', function () {
    const modal = document.getElementById('csvImportModal');
    if (modal) {
        modal.addEventListener('show.bs.modal', function () {
            const textarea = document.getElementById('csvTextarea');
            if (textarea) textarea.value = '';
            const preview = document.getElementById('csv-preview-area');
            if (preview) preview.innerHTML = '';
        });
    }
});

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
        alert('Nenhuma linha válida para importar.');
        return;
    }

    fetch('/transactions/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: rows }),
    })
        .then(function (response) {
            if (!response.ok) throw new Error('Erro ao importar: ' + response.status);
            return response.json();
        })
        .then(function (data) {
            location.href = '/transactions/';
        })
        .catch(function (err) {
            alert(err.message);
        });
}
