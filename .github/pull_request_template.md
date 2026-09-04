---
name: Pull Request Template
about: Template untuk kontribusi ke DevMap
title: ""
labels: ["needs-review"]
---

**Summary perbaikan**

<Singkat jelaskan perubahan apa>

**Issue terkait**

<Link ke issue ini, misal: fixes #123>

**Checklist sebelum submit**

- [ ] `devmap doctor` lolos (tanpa error)
- [ ] Test `pnpm test:cli` lolos (251 pass)
- [ ] New commands diupdate di `docs/commands.md`
- [ ] Tidak ada `console.log` di command files
- [ ] Registry terms sesuai standar (baca `docs/guide/05-signal-registry.md`)
- [ ] Code style match dengan `CONTRIBUTING.md`

**Catatan tambahan**

<Bisa menambahkan catatan untuk reviewer>
