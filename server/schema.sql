CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


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

CREATE TRIGGER set_updated_at_for_images
BEFORE UPDATE ON Images
FOR EACH ROW
EXECUTE FUNCTION update_modified_column();
