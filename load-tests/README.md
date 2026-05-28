# Load Tests

## Prerequisites

Install [k6](https://k6.io/docs/getting-started/installation/):

```bash
# Windows (Chocolatey)
choco install k6

# macOS (Homebrew)
brew install k6

# Linux (Debian/Ubuntu)
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

## Usage

```bash
# Health check load test
k6 run load-tests/health-check.js

# Auth flow load test (with custom credentials)
k6 run -e TEST_EMAIL="user@test.com" -e TEST_PASSWORD="pass123" load-tests/auth-flow.js

# Custom base URL
k6 run -e BASE_URL="https://staging.contex360.com" load-tests/health-check.js
```

## Scenarios

| Script | Description | Target RPS | Duration |
|--------|-------------|-----------|----------|
| `health-check.js` | Simulates concurrent health check requests | 50 peak | ~50s |
| `auth-flow.js` | Simulates login + session refresh flows | 20 peak | ~40s |
