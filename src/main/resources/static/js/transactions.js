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
