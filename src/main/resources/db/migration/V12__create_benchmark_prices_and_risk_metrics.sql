CREATE TABLE benchmark_prices (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    ticker     VARCHAR(20)  NOT NULL,
    "month"    DATE         NOT NULL,
    "close"    DOUBLE       NOT NULL,
    created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_benchmark_ticker_month UNIQUE (ticker, "month")
);

CREATE TABLE risk_metrics (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    ticker        VARCHAR(20) NOT NULL,
    calculated_at DATE        NOT NULL,
    beta          DOUBLE,
    alpha         DOUBLE,
    r_squared     DOUBLE,
    data_points   INT         NOT NULL,
    cdi_annual    DOUBLE,
    created_at    TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_risk_metrics_ticker_date UNIQUE (ticker, calculated_at)
);
