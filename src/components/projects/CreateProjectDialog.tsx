import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: {
    name: string;
    slug: string;
    description: string;
  }) => void;
  loading: boolean;
}

const CreateProjectDialog = ({ open, onOpenChange, onSubmit, loading }: CreateProjectDialogProps) => {
  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    description: ""
  });

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setFormData({
        name: "",
        slug: "",
        description: ""
      });
    }
  }, [open]);

  const handleNameChange = (name: string) => {
    // Auto-generate the slug from the name until the user diverges from
    // that derivation by editing the slug field themselves.
    setFormData(prev => {
      const slug = prev.slug === "" || prev.slug === prev.name.toLowerCase().replace(/[^a-z0-9_]/g, "")
        ? name.toLowerCase().replace(/[^a-z0-9_]/g, "")
        : prev.slug;
      return { ...prev, name, slug };
    });
  };

  const handleSlugChange = (value: string) => {
    // Force lowercase and only allow letters, numbers, underscores, and hyphens
    const slug = value.toLowerCase().replace(/[^a-z0-9_-]/g, "");
    setFormData(prev => ({ ...prev, slug }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>Create New Project</DialogTitle>
          <DialogDescription>
            Set up a new data collection project. You'll be added as the project owner.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Project Name*</Label>
              <Input
                id="name"
                placeholder="e.g., PRISM Cross-sectional Study"
                value={formData.name}
                onChange={(e) => handleNameChange(e.target.value)}
                required
                disabled={loading}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="slug">Project Code*</Label>
              <Input
                id="slug"
                placeholder="e.g., prism-study-2024"
                value={formData.slug}
                onChange={(e) => handleSlugChange(e.target.value)}
                required
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Short, memorable code (letters, numbers, underscores, hyphens). No spaces.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Brief description of the project goals..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                disabled={loading}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CreateProjectDialog;
