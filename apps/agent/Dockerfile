FROM python:3.12-slim
WORKDIR /app
COPY apps/agent/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY apps/agent/agent.py .
RUN useradd --system --uid 10001 agent
USER agent
CMD ["python","-u","agent.py"]
