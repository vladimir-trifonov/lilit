.PHONY: setup dev stop db-reset build lint format typecheck clean-all watch logs

setup:
	npm install
	docker compose up -d --wait
	npx prisma db push

dev:
	docker compose up -d --wait
	npm run dev

stop:
	docker compose down

db-reset:
	docker compose down -v
	docker compose up -d --wait
	npx prisma db push

build:
	npm run build

lint:
	npm run lint

format:
	npx eslint --fix .

typecheck:
	npx tsc --noEmit

clean-all:
	docker compose down -v --rmi all
