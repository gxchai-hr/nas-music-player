FROM python:3.11-slim

WORKDIR /app

# System dependencies for mutagen and bcrypt
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libffi-dev ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies (use Tsinghua PyPI mirror for faster install in China)
COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt

# Copy backend
COPY backend/ /app/

# Copy frontend
COPY frontend/ /app/frontend/

# Create persistent directories
RUN mkdir -p /app/data /app/config

EXPOSE 8080

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
