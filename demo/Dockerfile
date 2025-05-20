FROM golang:1.24-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./

RUN go mod download

COPY . .

ENV GOCACHE=/root/.cache/go-build
RUN --mount=type=cache,target="/root/.cache/go-build" for i in employees family hobbies products availability mood products_fg; do go build -o $i-server ./cmd/$i; done

# Employees
FROM alpine:latest AS employees
COPY --from=builder /app/employees-server ./employees
ENTRYPOINT [ "./employees" ]
EXPOSE 4001

# Family
FROM alpine:latest AS family
COPY --from=builder /app/family-server ./family
ENTRYPOINT [ "./family" ]
EXPOSE 4002

# Hobbies
FROM alpine:latest AS hobbies
COPY --from=builder /app/hobbies-server ./hobbies
ENTRYPOINT [ "./hobbies" ]
EXPOSE 4003

# Products
FROM alpine:latest AS products
COPY --from=builder /app/products-server ./products
ENTRYPOINT [ "./products" ]
EXPOSE 4004

# Availability
FROM alpine:latest AS availability
COPY --from=builder /app/availability-server ./availability
ENTRYPOINT [ "./availability" ]
EXPOSE 4007

# Mood
FROM alpine:latest AS mood
COPY --from=builder /app/mood-server ./mood
ENTRYPOINT [ "./mood" ]
EXPOSE 4008

# Products_fg
FROM alpine:latest AS products_fg
COPY --from=builder /app/products_fg-server ./products_fg
ENTRYPOINT [ "./products_fg" ]
EXPOSE 4010
