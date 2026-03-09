CREATE TABLE exchange_rates (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    "date"         DATE        NOT NULL,
    from_currency  VARCHAR(10) NOT NULL,
    to_currency    VARCHAR(10) NOT NULL,
    buy_rate       DOUBLE      NOT NULL,
    sell_rate      DOUBLE      NOT NULL,
    created_at     TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX uq_exchange_rate_date_pair ON exchange_rates ("date", from_currency, to_currency);
