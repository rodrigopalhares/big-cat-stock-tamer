function onDivCsvRowIgnoreToggle(checkbox) {
    var row = checkbox.closest('tr');
    if (checkbox.checked) {
        row.classList.add('text-decoration-line-through', 'text-muted');
        if (row.dataset.hasError === 'true') row.classList.add('table-danger');
    } else {
        row.classList.remove('text-decoration-line-through', 'text-muted');
        if (row.dataset.hasError === 'true') row.classList.remove('table-danger');
    }
    updateDivBatchCount();
}

function updateDivBatchCount() {
    var table = document.getElementById('divCsvPreviewTable');
    if (!table) return;
    var total = 0;
    table.querySelectorAll('tbody tr').forEach(function (tr) {
        var check = tr.querySelector('.div-csv-ignore-check');
        if (!check || !check.checked) total++;
    });
    var countEl = document.getElementById('divCsvBatchCount');
    var btn = document.getElementById('divCsvBatchSubmitBtn');
    if (countEl) countEl.textContent = total;
    if (btn) btn.disabled = (total === 0);
}

function toggleDivCsvErrorsOnly(showErrorsOnly) {
    var table = document.getElementById('divCsvPreviewTable');
    if (!table) return;
    table.querySelectorAll('tbody tr').forEach(function (tr) {
        if (showErrorsOnly && tr.dataset.hasError !== 'true') {
            tr.style.display = 'none';
        } else {
            tr.style.display = '';
        }
    });
}

function divBatchSubmit() {
    var table = document.getElementById('divCsvPreviewTable');
    if (!table) return;

    var rows = [];
    table.querySelectorAll('tbody tr').forEach(function (tr) {
        var ignoreCheck = tr.querySelector('.div-csv-ignore-check');
        if (ignoreCheck && ignoreCheck.checked) return;

        var fields = tr.querySelectorAll('.div-csv-field');
        if (fields.length === 0) return;

        var row = {};
        fields.forEach(function (field) {
            var key = field.dataset.field;
            if (key === 'totalAmount' || key === 'taxWithheld') {
                row[key] = parseFloat(field.value) || 0;
            } else {
                row[key] = field.value;
            }
        });
        rows.push(row);
    });

    if (rows.length === 0) {
        document.getElementById('csv-div-preview-area').innerHTML =
            '<div class="alert alert-warning">Nenhuma linha válida para importar.</div>';
        return;
    }

    var btn = document.getElementById('divCsvBatchSubmitBtn');
    if (btn) btn.disabled = true;

    fetch('/dividends/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: rows }),
    })
        .then(function (response) {
            if (!response.ok) throw new Error('Erro ao importar: ' + response.status);
            return response.json();
        })
        .then(function (data) {
            location.href = '/dividends/';
        })
        .catch(function (err) {
            document.getElementById('csv-div-preview-area').innerHTML =
                '<div class="alert alert-danger">' + err.message + '</div>';
            if (btn) btn.disabled = false;
        });
}
