# AUR packaging

本目录包含 `murmur-bin` 与 `murmur-nightly-bin` 的打包定义，使用 Murmur 仓库在 GitHub Releases 中提供的 x86_64 与 ARM64 AppImage。

## Publishing

The release workflow calls `.github/workflows/publish-aur.yml` after publishing a GitHub release;
the workflow can also be run manually for a specific tag. It selects the stable or nightly
package, then updates its version and both architectures' asset names and checksums, builds it
for the host architecture, regenerates `.SRCINFO`, and pushes it to the AUR.

To validate a release on Arch Linux:

```bash
sudo pacman -Syu --needed base-devel github-cli jq namcap
GH_TOKEN=$(gh auth token) RELEASE_TAG=v0.1.7 \
  packaging/aur/scripts/release.sh
```
