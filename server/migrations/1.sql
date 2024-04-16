CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_for_whatever_table
BEFORE UPDATE ON whatever_table
FOR EACH ROW
EXECUTE FUNCTION update_modified_column();


CREATE TYPE image_class_type AS ENUM ('unknown', 'pump', 'odometer');

CREATE TABLE images (
    id SERIAL PRIMARY KEY,
    class image_class_type,
    mileage INT,
    gallons DECIMAL(10, 3),
    inserted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fueling_id UUID
);
