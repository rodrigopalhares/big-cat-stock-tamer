document.addEventListener('DOMContentLoaded', function() {
    var dataEl = document.getElementById('evolution-data');
    if (!dataEl) return;

    var chartLabels = JSON.parse(dataEl.dataset.labels);
    var rawDatasets = JSON.parse(dataEl.dataset.datasets);
    var investedData = JSON.parse(dataEl.dataset.invested);

    var typeColors = {
        'BDR':            { bg: 'rgba(255, 159, 64, 0.6)',  border: 'rgb(255, 159, 64)' },
        'ETF':            { bg: 'rgba(75, 192, 192, 0.6)',  border: 'rgb(75, 192, 192)' },
        'REIT':           { bg: 'rgba(153, 102, 255, 0.6)', border: 'rgb(153, 102, 255)' },
        'STOCK':          { bg: 'rgba(54, 162, 235, 0.6)',  border: 'rgb(54, 162, 235)' },
        'TESOURO_DIRETO': { bg: 'rgba(255, 205, 86, 0.6)',  border: 'rgb(255, 205, 86)' },
    };

    var areaDatasets = rawDatasets.map(function(ds) {
        var colors = typeColors[ds.label] || { bg: 'rgba(201, 203, 207, 0.6)', border: 'rgb(201, 203, 207)' };
        return {
            label: ds.label,
            data: ds.data,
            fill: true,
            backgroundColor: colors.bg,
            borderColor: colors.border,
            borderWidth: 1,
            pointRadius: 0,
            pointHitRadius: 10,
            order: 2,
        };
    });

    areaDatasets.push({
        label: 'Total Investido',
        data: investedData,
        fill: false,
        backgroundColor: 'transparent',
        borderColor: 'rgb(220, 53, 69)',
        borderWidth: 2,
        borderDash: [6, 3],
        pointRadius: 0,
        pointHitRadius: 10,
        order: 1,
    });

    new Chart(document.getElementById('evolutionChart'), {
        type: 'line',
        data: { labels: chartLabels, datasets: areaDatasets },
        options: {
            responsive: true,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { grid: { display: false } },
                y: {
                    stacked: true,
                    ticks: {
                        callback: function(v) { return 'R$ ' + v.toLocaleString('pt-BR'); }
                    }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(ctx) {
                            return ctx.dataset.label + ': R$ ' + ctx.parsed.y.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
                        }
                    }
                },
                legend: { position: 'bottom' }
            }
        }
    });
});
