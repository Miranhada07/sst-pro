#!/bin/bash
# Script de instalação do serviço SST PRO para inicialização automática no Linux

echo "=== Configurando SST PRO para iniciar automaticamente no Boot (24/7) ==="

SERVICE_FILE="/etc/systemd/system/sst-pro.service"
LOCAL_SERVICE_FILE="$(dirname "$0")/sst-pro.service"

if [ "$EUID" -ne 0 ]; then
  echo "Por favor, execute este script com sudo para habilitar o serviço no sistema:"
  echo "sudo bash scripts/setup-service.sh"
  exit 1
fi

cp "$LOCAL_SERVICE_FILE" "$SERVICE_FILE"
systemctl daemon-reload
systemctl enable sst-pro.service
systemctl restart sst-pro.service

echo "✅ SST PRO configurado com sucesso como serviço do sistema!"
echo "O servidor agora iniciará automaticamente sempre que o computador ligar."
echo "Status atual do serviço:"
systemctl status sst-pro.service --no-pager
