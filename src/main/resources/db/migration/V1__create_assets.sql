CREATE TABLE assets (
    ticker   VARCHAR(50)  NOT NULL PRIMARY KEY,
    yf_ticker VARCHAR(100),
    name     VARCHAR(255),
    type     VARCHAR(50),
    currency VARCHAR(10)  NOT NULL DEFAULT 'BRL',
    created_at TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
