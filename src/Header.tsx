import { InputBase, Button, Toolbar } from "@mui/material";

function Header({
  search,
  onSearchChange,
  setShowProgressDialog,
}: {
  search: string;
  onSearchChange: (newSearch: string) => void;
  setShowProgressDialog: (show: boolean) => void;
}) {

  return (
    <Toolbar disableGutters sx={{ padding: 1 }}>
      <InputBase
        size="small"
        fullWidth
        placeholder="搜索…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        sx={{
          backgroundColor: "whitesmoke",
          borderRadius: "999px",
          padding: "8px 16px",
        }}
      />
      {/* Delete:IconButton和Menu相关代码，替换成直接按钮 */}
      <Button 
        sx={{ marginLeft: 0.5 }}
        onClick={() => setShowProgressDialog(true)}
      >
        传输进度
      </Button>
    </Toolbar>
  );
}

export default Header;