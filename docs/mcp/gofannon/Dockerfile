# Dockerfile
# Use an official Python runtime as a parent image
FROM python:3.11-slim

# Set the working directory in the container
WORKDIR /app

# Copy the requirements file
COPY requirements.txt .

# Install dependencies, including the gofannon package
RUN pip install --no-cache-dir -r requirements.txt

# Copy the server application file into the container
COPY main.py .

# Expose the port the app runs on
EXPOSE 8080

# Define the command to run the application using uvicorn
# This starts the ASGI server and makes it accessible on all network interfaces.
# Cloud Run will use this command to start the service.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]