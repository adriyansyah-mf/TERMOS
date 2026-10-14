# Termos untuk NixOS / Nix (x86_64-linux).
#
# File ini di-render oleh workflow release dengan versi dan hash SHA-256 dari
# paket .deb yang terbit di release yang sama, lalu dilampirkan sebagai aset
# release. Unduh `termos-<versi>.nix` dari halaman Releases, lalu:
#
#   nix-build termos-<versi>.nix
#   ./result/bin/termos
#
# atau pasang ke profil:
#
#   nix-env -i -f termos-<versi>.nix
#
# Sandbox Chromium memakai user namespace tanpa privilege (default NixOS).
# Kalau `security.unprivilegedUserNamespaces` dimatikan di sistemmu, jalankan
# dengan `termos --no-sandbox`.

let
  pkgs = import <nixpkgs> { };
  inherit (pkgs) lib stdenv fetchurl dpkg autoPatchelfHook makeWrapper;
  inherit (pkgs)
    alsa-lib at-spi2-atk at-spi2-core cairo cups dbus expat gtk3 libdrm
    libxkbcommon mesa nspr nss pango;
  inherit (pkgs.xorg)
    libX11 libXcomposite libXdamage libXext libXfixes libXrandr libxcb;
in

stdenv.mkDerivation (finalAttrs: {
  pname = "termos";
  version = "@VERSION@";

  src = fetchurl {
    url =
      "https://github.com/adriyansyah-mf/TERMOS/releases/download/v${finalAttrs.version}/termos-${finalAttrs.version}-amd64.deb";
    hash = "@DEB_HASH@";
  };

  # Chromium membawa sebagian besar pustakanya sendiri; daftar ini untuk binary
  # utama dan modul native (node-pty, serialport) yang menautkan ke sistem.
  nativeBuildInputs = [ dpkg autoPatchelfHook makeWrapper ];
  buildInputs = [
    alsa-lib at-spi2-atk at-spi2-core cairo cups dbus expat gtk3 libdrm
    libxkbcommon mesa nspr nss pango
    libX11 libXcomposite libXdamage libXext libXfixes libXrandr libxcb
  ];

  dontConfigure = true;
  dontBuild = true;

  unpackPhase = ''
    runHook preUnpack
    dpkg -x $src .
    runHook postUnpack
  '';

  installPhase = ''
    runHook preInstall

    cp -r usr $out
    cp -r opt $out

    # Aset .desktop dan ikon memakai path absolut /opt/Termos dari paket deb.
    substituteInPlace $out/share/applications/*.desktop \
      --replace-fail "/opt/Termos" "$out/opt/Termos"

    # chrome-sandbox butuh SUID; di nix store (nosuid) ia justru membuat
    # Electron menolak jalan. Tanpa file itu Electron memakai sandbox user
    # namespace.
    rm -f $out/opt/Termos/chrome-sandbox

    mkdir -p $out/bin
    makeWrapper $out/opt/Termos/termos $out/bin/termos

    runHook postInstall
  '';

  meta = {
    description = "Termos: SSH client, SFTP, port forwarding and Proxmox manager";
    homepage = "https://github.com/adriyansyah-mf/TERMOS";
    mainProgram = "termos";
    platforms = [ "x86_64-linux" ];
  };
})
