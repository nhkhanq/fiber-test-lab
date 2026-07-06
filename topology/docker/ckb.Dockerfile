# CKB devnet (genesis-custom) cho Fiber Test Lab.
# Nguồn ghim cứng (deterministic): image CKB official + fiber-scripts lấy từ chính repo FNN tag v0.8.0.
# LƯU Ý: chi tiết genesis (create_type_id / thứ tự cell) cần đối chiếu với FNN devnet config lúc
# `up` thật (E3-4) — kiểm chứng qua node_info.default_funding_lock_script. Chưa live-boot ở E3-3.
FROM nervos/ckb:v0.207.0

ARG FIBER_TAG=v0.8.0
ARG FIBER_CONTRACTS_URL=https://raw.githubusercontent.com/nervosnetwork/fiber/${FIBER_TAG}/tests/deploy/contracts

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# fiber on-chain scripts (compiled blobs, cùng version FNN đã pin) → nhúng vào genesis lúc entrypoint.
RUN mkdir -p /fiber-scripts \
    && for c in auth funding-lock commitment-lock simple_udt xudt_rce always_success; do \
         curl -fsSL -o "/fiber-scripts/$c" "${FIBER_CONTRACTS_URL}/$c"; \
       done

COPY ckb/entrypoint.sh /usr/local/bin/flab-ckb-entrypoint.sh
RUN chmod +x /usr/local/bin/flab-ckb-entrypoint.sh

ENV CKB_DATA_DIR=/var/lib/ckb
EXPOSE 8114 8115

ENTRYPOINT ["/usr/local/bin/flab-ckb-entrypoint.sh"]
