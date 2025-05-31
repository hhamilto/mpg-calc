-- Create cars table to store basic car information
CREATE TABLE cars (
    id SERIAL PRIMARY KEY,
    phone_number VARCHAR(255) NOT NULL,
    make VARCHAR(50),
    model VARCHAR(50),
    year INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add car_id foreign key to images table
ALTER TABLE images ADD COLUMN car_id INTEGER REFERENCES cars(id);

-- Add indexes for better query performance
CREATE INDEX idx_cars_phone_number ON cars(phone_number);
CREATE INDEX idx_images_car_id ON images(car_id);

-- Add trigger for updated_at on cars table
CREATE TRIGGER set_updated_at_for_cars
BEFORE UPDATE ON cars
FOR EACH ROW
EXECUTE FUNCTION update_modified_column();