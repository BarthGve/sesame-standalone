// pdfmake 0.3 ne publie pas de types. On déclare la surface réellement utilisée
// (création d'un document et téléchargement), pas l'API complète.
declare module "pdfmake/build/pdfmake" {
  type Document = { download: (nomFichier?: string) => void };
  const pdfMake: {
    addVirtualFileSystem: (vfs: Record<string, string>) => void;
    fonts?: Record<string, Record<string, string>>;
    createPdf: (docDefinition: unknown) => Document;
  };
  export default pdfMake;
}

declare module "pdfmake/build/vfs_fonts" {
  const vfs: Record<string, string>;
  export default vfs;
}
