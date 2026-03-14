FROM golang:1.25-trixie AS build

COPY . /littletable
WORKDIR /littletable
RUN go build -o ./littletable ./cmd/littletablesrv

FROM debian:trixie-slim AS final

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update
RUN apt-get upgrade -qq -y
RUN apt-get install -qq -y ca-certificates

COPY --from=build /littletable/littletable /littletable
CMD ["/littletable"]
