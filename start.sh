#!/bin/bash

# This script starts both the backend and frontend servers
# It ensures that the required ports are free, installs dependencies if needed

set -eu
(set -o pipefail) 2>/dev/null && set -o pipefail

# Determine the root directory of the project
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PID=""
FRONTEND_PID=""

# cleanup function to stop both servers when the script exits
cleanup() {
  exit_code=$?
  trap - EXIT INT TERM

  if [ -n "${BACKEND_PID}" ] && kill -0 "${BACKEND_PID}" 2>/dev/null; then
    kill "${BACKEND_PID}" 2>/dev/null || true
  fi

  if [ -n "${FRONTEND_PID}" ] && kill -0 "${FRONTEND_PID}" 2>/dev/null; then
    kill "${FRONTEND_PID}" 2>/dev/null || true
  fi

  if [ -n "${BACKEND_PID}" ]; then
    wait "${BACKEND_PID}" 2>/dev/null || true
  fi

  if [ -n "${FRONTEND_PID}" ]; then
    wait "${FRONTEND_PID}" 2>/dev/null || true
  fi

  exit "${exit_code}"
}

check_port_free() {
  port="$1"
  service_name="$2"

  if ! command -v lsof >/dev/null 2>&1; then
    return
  fi

  if lsof -iTCP:"${port}" -sTCP:LISTEN -n -P >/dev/null 2>&1; then
    echo "Error: ${service_name} port ${port} is already in use."
    lsof -iTCP:"${port}" -sTCP:LISTEN -n -P
    exit 1
  fi
}

ensure_backend_dependencies() {
  if [ ! -d "${ROOT_DIR}/backend/node_modules" ]; then
    echo "Installing backend dependencies..."
    (
      cd "${ROOT_DIR}/backend"
      bun install
    )
  fi
}

ensure_frontend_dependencies() {
  if [ ! -x "${ROOT_DIR}/frontend/node_modules/.bin/next" ]; then
    echo "Installing frontend dependencies..."
    (
      cd "${ROOT_DIR}/frontend"
      bun install
    )
  fi
}

if ! command -v bun >/dev/null 2>&1; then
  echo "Error: bun is required but was not found in PATH."
  exit 1
fi

if [ ! -f "${ROOT_DIR}/config.ts" ]; then
  echo "Error: config.ts is missing at ${ROOT_DIR}/config.ts"
  exit 1
fi

check_port_free 4000 "Backend"
check_port_free 3000 "Frontend"

ensure_backend_dependencies
ensure_frontend_dependencies

echo "Starting backend server..."
cp "${ROOT_DIR}/config.ts" "${ROOT_DIR}/backend/config.ts"
(
  cd "${ROOT_DIR}/backend"
  bun src/index.ts
) &
BACKEND_PID=$!

echo "Starting frontend server..."
(
  cd "${ROOT_DIR}/frontend"
  bun dev
) &
FRONTEND_PID=$!

trap cleanup EXIT INT TERM

echo "Both servers are starting..."
echo "Press Ctrl+C to stop both servers"

while true; do
  if ! kill -0 "${BACKEND_PID}" 2>/dev/null; then
    backend_exit=0
    wait "${BACKEND_PID}" || backend_exit=$?
    exit "${backend_exit}"
  fi

  if ! kill -0 "${FRONTEND_PID}" 2>/dev/null; then
    frontend_exit=0
    wait "${FRONTEND_PID}" || frontend_exit=$?
    exit "${frontend_exit}"
  fi

  sleep 1
done
