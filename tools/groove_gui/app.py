"""tkinter view for the GE-155 installer. Run: pythonw tools/GrooveInstaller.pyw (Windows) or python3 tools/GrooveInstaller.pyw."""
import os
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from . import controller as ctl

TITLE = "Groove Engine — instalador de niveles (BORRADOR GE-155)"
WARNING = ("Antes de instalar: saca la SD de la Switch (instalación sin conexión) y haz copia de tu partida con JKSV. "
           "Esto solo prepara archivos; nada se ha probado aún en la consola.")


class App(ttk.Frame):
    def __init__(self, master, confirm=None, ask_file=None, ask_dir=None):
        super().__init__(master, padding=10)
        self.master = master
        self.confirm = confirm or (lambda title, msg: messagebox.askyesno(title, msg, parent=master))
        self.ask_file = ask_file or (lambda: filedialog.askopenfilename(
            parent=master, title="Elige un paquete .groove",
            filetypes=[("Paquetes Groove", "*.groove"), ("Todos", "*.*")]))
        self.ask_dir = ask_dir or (lambda: filedialog.askdirectory(parent=master, title="Raíz de la tarjeta SD"))
        self.pkg = tk.StringVar()
        self.sd = tk.StringVar()
        self.slot = tk.StringVar(value="auto")
        master.title(TITLE)
        self.grid(sticky="nsew")
        master.columnconfigure(0, weight=1)
        master.rowconfigure(0, weight=1)
        self._build()

    # -------------------------------------------------------------- layout
    def _build(self):
        self.columnconfigure(1, weight=1)
        ttk.Label(self, text=WARNING, wraplength=640, foreground="#8a4b00").grid(row=0, column=0, columnspan=4,
                                                                               sticky="w", pady=(0, 8))
        ttk.Label(self, text="Paquete .groove").grid(row=1, column=0, sticky="w")
        ttk.Entry(self, textvariable=self.pkg).grid(row=1, column=1, sticky="ew", padx=4)
        ttk.Button(self, text="Examinar...", command=self.pick_pkg).grid(row=1, column=2)
        self.b_validate = ttk.Button(self, text="Validar", command=self.on_validate)
        self.b_validate.grid(row=1, column=3, padx=(4, 0))

        ttk.Label(self, text="Raíz de la SD").grid(row=2, column=0, sticky="w")
        ttk.Entry(self, textvariable=self.sd).grid(row=2, column=1, sticky="ew", padx=4)
        ttk.Button(self, text="Examinar...", command=self.pick_sd).grid(row=2, column=2)
        self.b_status = ttk.Button(self, text="Estado", command=self.on_status)
        self.b_status.grid(row=2, column=3, padx=(4, 0))

        box = ttk.Frame(self)
        box.grid(row=3, column=0, columnspan=4, sticky="w", pady=6)
        ttk.Label(box, text="Casilla:").pack(side="left")
        for val, txt in (("auto", "Automática"), ("A", "A (0,9,0)"), ("B", "B (0,9,1)"), ("none", "Sin casilla")):
            ttk.Radiobutton(box, text=txt, value=val, variable=self.slot).pack(side="left", padx=4)
        self.b_install = ttk.Button(box, text="Instalar", command=self.on_install)
        self.b_install.pack(side="left", padx=(16, 4))
        self.b_recover = ttk.Button(box, text="Recuperar", command=self.on_recover)
        self.b_recover.pack(side="left")

        cols = ("title", "version", "slot", "save", "id")
        self.tree = ttk.Treeview(self, columns=cols, show="headings", height=6, selectmode="browse")
        for c, txt, w in (("title", "Título", 200), ("version", "Versión", 70), ("slot", "Casilla", 60),
                          ("save", "Guardado", 70), ("id", "Id", 330)):
            self.tree.heading(c, text=txt)
            self.tree.column(c, width=w, anchor="w")
        self.tree.grid(row=4, column=0, columnspan=4, sticky="nsew")
        self.rowconfigure(4, weight=1)

        acts = ttk.Frame(self)
        acts.grid(row=5, column=0, columnspan=4, sticky="w", pady=6)
        self.b_assign_a = ttk.Button(acts, text="Poner en A", command=lambda: self.on_assign(0))
        self.b_assign_b = ttk.Button(acts, text="Poner en B", command=lambda: self.on_assign(1))
        self.b_unassign = ttk.Button(acts, text="Quitar de la casilla", command=self.on_unassign)
        self.b_uninstall = ttk.Button(acts, text="Desinstalar...", command=self.on_uninstall)
        for b in (self.b_assign_a, self.b_assign_b, self.b_unassign, self.b_uninstall):
            b.pack(side="left", padx=4)

        self.log = tk.Text(self, height=12, wrap="word", state="disabled")
        self.log.grid(row=6, column=0, columnspan=4, sticky="nsew")
        self.rowconfigure(6, weight=1)

    # -------------------------------------------------------------- helpers
    def write(self, outcome):
        self.log.configure(state="normal")
        self.log.insert("end", ("✔ " if outcome.ok else "✖ ") + outcome.text() + "\n\n")
        self.log.see("end")
        self.log.configure(state="disabled")
        self.last = outcome
        return outcome

    def log_text(self):
        return self.log.get("1.0", "end")

    def _need(self, var, what):
        v = var.get().strip()
        if not v:
            return self.write(ctl.Outcome(False, f"Falta {what}"))
        return v

    def selected_id(self):
        sel = self.tree.selection()
        if not sel:
            self.write(ctl.Outcome(False, "Selecciona un nivel de la lista"))
            return None
        return self.tree.set(sel[0], "id")

    def refresh(self):
        sd = self.sd.get().strip()
        self.tree.delete(*self.tree.get_children())
        if not sd or not os.path.isdir(sd):
            return None
        out = ctl.status(sd)
        if out.data:
            for r in out.data["rows"]:
                self.tree.insert("", "end", iid=r["id"], values=(r["title"], r["version"], r["slot"], r["save"], r["id"]))
        return out

    # -------------------------------------------------------------- actions
    def pick_pkg(self):
        p = self.ask_file()
        if p:
            self.pkg.set(p)
            self.on_validate()

    def pick_sd(self):
        d = self.ask_dir()
        if d:
            self.sd.set(d)
            self.on_status()

    def on_validate(self):
        p = self._need(self.pkg, "el paquete")
        return p if isinstance(p, ctl.Outcome) else self.write(ctl.validate(p))

    def on_status(self):
        sd = self._need(self.sd, "la raíz de la SD")
        if isinstance(sd, ctl.Outcome):
            return sd
        out = self.refresh()
        return self.write(out or ctl.status(sd))

    def on_install(self):
        p = self._need(self.pkg, "el paquete")
        sd = self._need(self.sd, "la raíz de la SD")
        if isinstance(p, ctl.Outcome) or isinstance(sd, ctl.Outcome):
            return self.last
        slot = {"auto": "auto", "A": 0, "B": 1, "none": None}[self.slot.get()]
        out = self.write(ctl.install(p, sd, slot))
        self.refresh()
        return out

    def on_recover(self):
        sd = self._need(self.sd, "la raíz de la SD")
        if isinstance(sd, ctl.Outcome):
            return sd
        out = self.write(ctl.recover(sd))
        self.refresh()
        return out

    def _with_selected(self, fn):
        sd = self._need(self.sd, "la raíz de la SD")
        if isinstance(sd, ctl.Outcome):
            return sd
        pid = self.selected_id()
        if pid is None:
            return self.last
        out = self.write(fn(sd, pid))
        self.refresh()
        return out

    def on_assign(self, idx):
        return self._with_selected(lambda sd, pid: ctl.assign(sd, pid, idx))

    def on_unassign(self):
        return self._with_selected(ctl.unassign)

    def on_uninstall(self):
        pid = self.tree.selection()
        if pid and not self.confirm("Desinstalar", "¿Desinstalar el nivel seleccionado?\n"
                                                    "Su guardado en custom-saves/ se conserva."):
            return self.write(ctl.Outcome(False, "Cancelado"))
        return self._with_selected(ctl.uninstall)


def _dpi_aware():
    if os.name == "nt":  # sharper text on Windows; GUI-only, never imported by the core
        try:
            import ctypes
            ctypes.windll.shcore.SetProcessDpiAwareness(1)
        except Exception:
            pass


def main():
    _dpi_aware()
    root = tk.Tk()
    root.minsize(720, 520)
    App(root)
    root.mainloop()
