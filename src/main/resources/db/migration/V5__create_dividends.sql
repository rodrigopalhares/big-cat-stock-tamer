CREATE TABLE dividends (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    asset_id     VARCHAR(50) NOT NULL,
    "type"       VARCHAR(20) NOT NULL,
    "date"       DATE        NOT NULL,
    total_amount DOUBLE      NOT NULL,
    tax_withheld DOUBLE      NOT NULL DEFAULT 0.0,
    notes        CLOB,
    created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_dividend_asset FOREIGN KEY (asset_id) REFERENCES assets(ticker) ON DELETE CASCADE
);
