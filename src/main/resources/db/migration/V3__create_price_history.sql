CREATE TABLE price_history (
    id        INT AUTO_INCREMENT PRIMARY KEY,
    asset_id  VARCHAR(50) NOT NULL,
    date      DATE        NOT NULL,
    close     DOUBLE      NOT NULL,
    created_at TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_price_history_asset FOREIGN KEY (asset_id) REFERENCES assets(ticker) ON DELETE CASCADE,
    CONSTRAINT uq_price_history_asset_date UNIQUE (asset_id, date)
);
