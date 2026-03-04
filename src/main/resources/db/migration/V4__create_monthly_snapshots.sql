CREATE TABLE monthly_snapshots (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    asset_id     VARCHAR(50) NOT NULL,
    "month"      DATE        NOT NULL,
    quantity     DOUBLE      NOT NULL,
    avg_price    DOUBLE      NOT NULL,
    market_price DOUBLE      NOT NULL,
    total_cost   DOUBLE      NOT NULL,
    market_value DOUBLE      NOT NULL,
    created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_monthly_snapshot_asset FOREIGN KEY (asset_id) REFERENCES assets(ticker) ON DELETE CASCADE,
    CONSTRAINT uq_monthly_snapshot_asset_month UNIQUE (asset_id, "month")
);
