CREATE TABLE transactions (
    id        INT AUTO_INCREMENT PRIMARY KEY,
    asset_id  VARCHAR(50) NOT NULL,
    type      VARCHAR(10) NOT NULL,
    quantity  DOUBLE      NOT NULL,
    price     DOUBLE      NOT NULL,
    fees      DOUBLE      NOT NULL DEFAULT 0.0,
    date      DATE        NOT NULL,
    broker    VARCHAR(255),
    notes     CLOB,
    created_at TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_transaction_asset FOREIGN KEY (asset_id) REFERENCES assets(ticker) ON DELETE CASCADE
);
