.PHONY: setup dev stop db-reset build lint format typecheck clean clean-all watch logs

setup:
	npm install
	docker compose up -d --wait
	npx prisma migrate deploy

dev:
	docker compose up -d --wait
	npm run dev

stop:
	docker compose down

build:
	npm run build

lint:
	npm run lint

format:
	npx eslint --fix .

typecheck:
	npx tsc --noEmit

clean:
	docker compose down -v
	rm -rf /tmp/lilit
	rm -rf .next

logs:
	@LOG=$$(ls -t $${TMPDIR:-/tmp}/lilit/*/live.log 2>/dev/null | head -1); \
	if [ -z "$$LOG" ]; then echo "No live logs found"; exit 1; fi; \
	echo "Tailing $$LOG"; \
	tail -f "$$LOG"

clean-all:
	docker compose down -v --rmi all
