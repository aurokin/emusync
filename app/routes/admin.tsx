import { useState, useEffect } from "react";
import type { Route } from "./+types/admin";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Skeleton from "@mui/material/Skeleton";
import Fade from "@mui/material/Fade";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import SaveIcon from "@mui/icons-material/Save";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DevicesIcon from "@mui/icons-material/Devices";
import AndroidIcon from "@mui/icons-material/Android";
import ComputerIcon from "@mui/icons-material/Computer";
import SportsEsportsIcon from "@mui/icons-material/SportsEsports";
import { Link } from "react-router";
import type { EmuServer } from "~/server/types";

export function meta(_args: Route.MetaArgs) {
    return [
        { title: "Admin - EmuSync" },
        {
            name: "description",
            content: "Configure EmuSync server and devices",
        },
    ];
}

// Grouped server config field definitions by platform
const serverFieldGroups: {
    title: string;
    icon: string;
    fields: { key: keyof EmuServer; label: string; description: string }[];
}[] = [
    {
        title: "Nintendo",
        icon: "nintendo",
        fields: [
            {
                key: "dolphinGC",
                label: "GameCube Saves",
                description: "Dolphin emulator",
            },
            {
                key: "dolphinWii",
                label: "Wii Saves",
                description: "Dolphin emulator",
            },
            {
                key: "azahar",
                label: "3DS Saves",
                description: "Azahar emulator",
            },
            {
                key: "cemuSave",
                label: "Wii U Saves",
                description: "Cemu emulator",
            },
            {
                key: "melonds",
                label: "MelonDS Data",
                description: "MelonDS emulator",
            },
            {
                key: "switchSave",
                label: "Switch Saves",
                description: "Native backup",
            },
            {
                key: "yuzuSave",
                label: "Switch Saves (Yuzu)",
                description: "Yuzu emulator",
            },
            {
                key: "ryujinxSave",
                label: "Switch Saves (Ryujinx)",
                description: "Ryujinx emulator",
            },
            {
                key: "mupenFzSave",
                label: "N64 Saves",
                description: "Mupen64Plus FZ",
            },
        ],
    },
    {
        title: "Sony",
        icon: "sony",
        fields: [
            {
                key: "ppssppSave",
                label: "PSP Saves",
                description: "PPSSPP emulator",
            },
            {
                key: "ppssppState",
                label: "PSP States",
                description: "PPSSPP emulator",
            },
            {
                key: "nethersx2Save",
                label: "PS2 Memory Cards",
                description: "NetherSX2 emulator",
            },
            {
                key: "rpcs3Save",
                label: "PS3 Saves",
                description: "RPCS3 emulator",
            },
            {
                key: "vita3kSave",
                label: "PS Vita Saves",
                description: "Vita3K emulator",
            },
        ],
    },
    {
        title: "Microsoft",
        icon: "microsoft",
        fields: [
            {
                key: "xemuSave",
                label: "Xbox Saves",
                description: "xemu emulator",
            },
            {
                key: "xeniaSave",
                label: "Xbox 360 Saves",
                description: "Xenia emulator",
            },
        ],
    },
    {
        title: "Multi-Platform",
        icon: "multi",
        fields: [
            {
                key: "retroarchSave",
                label: "RetroArch Saves",
                description: "All cores",
            },
            {
                key: "retroarchState",
                label: "RetroArch States",
                description: "All cores",
            },
            {
                key: "retroarchRgState",
                label: "RetroArch RG States",
                description: "Handheld devices",
            },
        ],
    },
    {
        title: "System",
        icon: "system",
        fields: [
            {
                key: "workDir",
                label: "Work Directory",
                description: "Temporary file storage",
            },
        ],
    },
];

// Device field definitions
const deviceBaseFields = [
    { key: "name", label: "Device Name", required: true },
    { key: "ip", label: "IP Address", required: true },
    { key: "port", label: "SSH Port", required: true, type: "number" },
    { key: "user", label: "Username", required: true },
    { key: "password", label: "Password", required: true, type: "password" },
    { key: "workDir", label: "Work Directory", required: true },
];

// Grouped device emulator fields by platform
const deviceEmulatorGroups: {
    title: string;
    fields: { key: string; label: string }[];
}[] = [
    {
        title: "Nintendo",
        fields: [
            { key: "dolphinGC", label: "GameCube Saves" },
            { key: "dolphinWii", label: "Wii Saves" },
            { key: "dolphinDroidDump", label: "Dolphin Android Dump" },
            { key: "azahar", label: "3DS Saves" },
            { key: "cemuSave", label: "Wii U Saves" },
            { key: "melonds", label: "MelonDS Data" },
            { key: "switchSave", label: "Switch Saves" },
            { key: "yuzuSave", label: "Yuzu Saves" },
            { key: "yuzuDroid", label: "Yuzu Android" },
            { key: "yuzuDroidDump", label: "Yuzu Android Dump" },
            { key: "ryujinxSave", label: "Ryujinx Saves" },
            { key: "mupenFzSave", label: "N64 Saves" },
        ],
    },
    {
        title: "Sony",
        fields: [
            { key: "ppssppSave", label: "PSP Saves" },
            { key: "ppssppState", label: "PSP States" },
            {
                key: "nethersx2Save",
                label: "PS2 Memory Cards (memcards)",
            },
            { key: "pcsx2Save", label: "PCSX2 Saves" },
            { key: "rpcs3Save", label: "PS3 Saves" },
            { key: "vita3kSave", label: "PS Vita Saves" },
        ],
    },
    {
        title: "Microsoft",
        fields: [
            { key: "xemuSave", label: "Xbox Saves" },
            { key: "xeniaSave", label: "Xbox 360 Saves" },
        ],
    },
    {
        title: "Multi-Platform",
        fields: [
            { key: "retroarchSave", label: "RetroArch Saves" },
            { key: "retroarchState", label: "RetroArch States" },
        ],
    },
];

const osOptions: {
    value: string;
    label: string;
    icon: "android" | "computer" | "console";
}[] = [
    { value: "android", label: "Android", icon: "android" },
    { value: "linux", label: "Linux", icon: "computer" },
    { value: "windows", label: "Windows", icon: "computer" },
    { value: "muos", label: "muOS", icon: "console" },
    { value: "nx", label: "Nintendo Switch", icon: "console" },
];

// OS icon component
function OsIcon({
    os,
    size = "small",
}: {
    os: string;
    size?: "small" | "medium";
}) {
    const iconProps = { fontSize: size, sx: { color: "#7aa2f7" } };
    switch (os) {
        case "android":
            return <AndroidIcon {...iconProps} sx={{ color: "#a4cf69" }} />;
        case "linux":
        case "windows":
            return <ComputerIcon {...iconProps} />;
        case "muos":
        case "nx":
            return (
                <SportsEsportsIcon {...iconProps} sx={{ color: "#f28fad" }} />
            );
        default:
            return <DevicesIcon {...iconProps} />;
    }
}

type DeviceData = Record<string, unknown>;

const sanitizeDevicePayload = (device: DeviceData): DeviceData => {
    const sanitized = { ...device };
    delete (sanitized as Record<string, unknown>).nethersx2DroidDump;
    return sanitized;
};

export default function Admin() {
    // Server config state
    const [serverConfig, setServerConfig] = useState<Partial<EmuServer>>({});
    const [serverLoading, setServerLoading] = useState(true);
    const [serverSaving, setServerSaving] = useState(false);

    // Device state
    const [devices, setDevices] = useState<DeviceData[]>([]);
    const [devicesLoading, setDevicesLoading] = useState(true);
    const [deviceDialogOpen, setDeviceDialogOpen] = useState(false);
    const [editingDevice, setEditingDevice] = useState<DeviceData | null>(null);
    const [deviceForm, setDeviceForm] = useState<DeviceData>({});
    const [deviceSaving, setDeviceSaving] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [deviceToDelete, setDeviceToDelete] = useState<string | null>(null);

    // Notification state
    const [snackbar, setSnackbar] = useState<{
        open: boolean;
        message: string;
        severity: "success" | "error";
    }>({ open: false, message: "", severity: "success" });

    // Load server config
    useEffect(() => {
        fetch("/api/admin")
            // Without the status check a 404/500 error body was set as the
            // config, so the form showed { error: ... } as the saved state and
            // a subsequent save would have written it back.
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then((data) => {
                setServerConfig(data);
                setServerLoading(false);
            })
            .catch(() => {
                setSnackbar({
                    open: true,
                    message: "Failed to load server config",
                    severity: "error",
                });
                setServerLoading(false);
            });
    }, []);

    // Load devices
    useEffect(() => {
        fetchDevices();
    }, []);

    const fetchDevices = () => {
        fetch("/api/admin/devices")
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then((data) => {
                setDevices(data);
                setDevicesLoading(false);
            })
            .catch(() => {
                setSnackbar({
                    open: true,
                    message: "Failed to load devices",
                    severity: "error",
                });
                setDevicesLoading(false);
            });
    };

    // Server config handlers
    const handleServerFieldChange = (key: keyof EmuServer, value: string) => {
        setServerConfig((prev) => ({ ...prev, [key]: value }));
    };

    const handleSaveServerConfig = async () => {
        setServerSaving(true);
        try {
            const res = await fetch("/api/admin", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(serverConfig),
            });
            if (res.ok) {
                setSnackbar({
                    open: true,
                    message: "Server config saved successfully",
                    severity: "success",
                });
            } else {
                throw new Error("Failed to save");
            }
        } catch {
            setSnackbar({
                open: true,
                message: "Failed to save server config",
                severity: "error",
            });
        }
        setServerSaving(false);
    };

    // Device handlers
    const handleOpenAddDevice = () => {
        setEditingDevice(null);
        setDeviceForm({ os: "linux", port: 22 });
        setDeviceDialogOpen(true);
    };

    const handleOpenEditDevice = (device: DeviceData) => {
        setEditingDevice(device);
        setDeviceForm(sanitizeDevicePayload(device));
        setDeviceDialogOpen(true);
    };

    const handleDeviceFormChange = (key: string, value: unknown) => {
        setDeviceForm((prev) => ({ ...prev, [key]: value }));
    };

    const handleSaveDevice = async () => {
        setDeviceSaving(true);
        try {
            const isEditing = editingDevice !== null;
            const url = isEditing
                ? `/api/admin/devices/${encodeURIComponent(editingDevice.name as string)}`
                : "/api/admin/devices";
            const method = isEditing ? "PUT" : "POST";

            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(sanitizeDevicePayload(deviceForm)),
            });

            if (res.ok) {
                setSnackbar({
                    open: true,
                    message: isEditing
                        ? "Device updated successfully"
                        : "Device added successfully",
                    severity: "success",
                });
                setDeviceDialogOpen(false);
                fetchDevices();
            } else {
                const data = await res.json();
                throw new Error(data.error || "Failed to save device");
            }
        } catch (err) {
            setSnackbar({
                open: true,
                message:
                    err instanceof Error
                        ? err.message
                        : "Failed to save device",
                severity: "error",
            });
        }
        setDeviceSaving(false);
    };

    const handleConfirmDelete = async () => {
        if (!deviceToDelete) return;

        try {
            const res = await fetch(
                `/api/admin/devices/${encodeURIComponent(deviceToDelete)}`,
                { method: "DELETE" },
            );

            if (res.ok) {
                setSnackbar({
                    open: true,
                    message: "Device deleted successfully",
                    severity: "success",
                });
                fetchDevices();
            } else {
                throw new Error("Failed to delete");
            }
        } catch {
            setSnackbar({
                open: true,
                message: "Failed to delete device",
                severity: "error",
            });
        }
        setDeleteDialogOpen(false);
        setDeviceToDelete(null);
    };

    const inputSx = {
        "& .MuiOutlinedInput-root": {
            backgroundColor: "rgba(17, 24, 37, 0.6)",
            borderRadius: 2,
            transition: "box-shadow 0.2s ease, border-color 0.2s ease",
            "& fieldset": {
                borderColor: "rgba(122, 162, 247, 0.2)",
                transition: "border-color 0.2s ease",
            },
            "&:hover fieldset": {
                borderColor: "rgba(79, 209, 197, 0.4)",
            },
            "&.Mui-focused": {
                boxShadow: "0 0 0 3px rgba(79, 209, 197, 0.15)",
                "& fieldset": {
                    borderColor: "#4fd1c5",
                },
            },
        },
        "& .MuiInputLabel-root": {
            color: "text.secondary",
        },
        "& .MuiInputBase-input": {
            fontSize: "0.9rem",
        },
    };

    const accordionSx = {
        backgroundColor: "rgba(17, 24, 37, 0.82)",
        borderRadius: "12px !important",
        border: "1px solid rgba(122, 162, 247, 0.2)",
        transition: "border-color 0.2s ease, box-shadow 0.2s ease",
        "&:before": { display: "none" },
        mb: 2,
        "&.Mui-expanded": {
            borderColor: "rgba(79, 209, 197, 0.4)",
            boxShadow: "0 4px 20px rgba(79, 209, 197, 0.08)",
        },
    };

    const groupHeaderSx = {
        color: "#7aa2f7",
        fontSize: "0.7rem",
        fontWeight: 600,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        mb: 1.5,
        mt: 2,
        display: "flex",
        alignItems: "center",
        gap: 1,
        "&:first-of-type": {
            mt: 0,
        },
    };

    return (
        <Box
            sx={{
                minHeight: "100vh",
                background: `
                    radial-gradient(ellipse at 20% 0%, rgba(79, 209, 197, 0.04) 0%, transparent 50%),
                    radial-gradient(ellipse at 80% 100%, rgba(122, 162, 247, 0.04) 0%, transparent 50%),
                    linear-gradient(180deg, rgba(11, 15, 23, 0) 0%, rgba(11, 15, 23, 1) 100%)
                `,
            }}
        >
            <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}>
                {/* Header */}
                <Fade in timeout={400}>
                    <Box
                        sx={{
                            mb: 4,
                            display: "flex",
                            alignItems: "center",
                            gap: 2,
                        }}
                    >
                        <IconButton
                            component={Link}
                            to="/"
                            sx={{
                                color: "text.secondary",
                                transition: "color 0.2s ease",
                                "&:hover": { color: "#4fd1c5" },
                            }}
                        >
                            <ArrowBackIcon />
                        </IconButton>
                        <Box>
                            <Typography
                                variant="caption"
                                sx={{
                                    color: "#7aa2f7",
                                    letterSpacing: "0.2em",
                                    display: "block",
                                    mb: 1,
                                }}
                            >
                                ADMINISTRATION
                            </Typography>
                            <Typography
                                variant="h3"
                                sx={{
                                    fontFamily: '"Unbounded", sans-serif',
                                    fontWeight: 600,
                                    mb: 1,
                                }}
                            >
                                Configuration
                            </Typography>
                            <Typography
                                sx={{
                                    color: "text.secondary",
                                    maxWidth: 520,
                                    fontSize: "0.95rem",
                                }}
                            >
                                Manage server paths and device connections
                            </Typography>
                        </Box>
                    </Box>
                </Fade>

                {/* Device Management */}
                <Fade in timeout={500} style={{ transitionDelay: "100ms" }}>
                    <Accordion defaultExpanded sx={accordionSx}>
                        <AccordionSummary
                            expandIcon={
                                <ExpandMoreIcon sx={{ color: "#7aa2f7" }} />
                            }
                        >
                            <Box
                                sx={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 1.5,
                                }}
                            >
                                <DevicesIcon
                                    sx={{
                                        color: "#4fd1c5",
                                        fontSize: "1.3rem",
                                    }}
                                />
                                <Box>
                                    <Typography
                                        sx={{
                                            fontFamily:
                                                '"Unbounded", sans-serif',
                                            fontWeight: 600,
                                            fontSize: "1.1rem",
                                        }}
                                    >
                                        Devices
                                    </Typography>
                                    <Typography
                                        variant="caption"
                                        sx={{ color: "text.secondary" }}
                                    >
                                        Manage device connections and emulator
                                        paths
                                    </Typography>
                                </Box>
                            </Box>
                        </AccordionSummary>
                        <AccordionDetails>
                            {devicesLoading ? (
                                <Box>
                                    <Box
                                        sx={{
                                            mb: 2,
                                            display: "flex",
                                            justifyContent: "flex-end",
                                        }}
                                    >
                                        <Skeleton
                                            variant="rounded"
                                            width={120}
                                            height={36}
                                            sx={{
                                                bgcolor:
                                                    "rgba(122, 162, 247, 0.1)",
                                            }}
                                        />
                                    </Box>
                                    <Box
                                        sx={{
                                            borderRadius: 2,
                                            border: "1px solid rgba(122, 162, 247, 0.2)",
                                            overflow: "hidden",
                                        }}
                                    >
                                        {[1, 2, 3].map((i) => (
                                            <Box
                                                key={i}
                                                sx={{
                                                    display: "flex",
                                                    gap: 2,
                                                    p: 1.5,
                                                    borderBottom:
                                                        "1px solid rgba(122, 162, 247, 0.1)",
                                                }}
                                            >
                                                <Skeleton
                                                    variant="text"
                                                    width={100}
                                                    sx={{
                                                        bgcolor:
                                                            "rgba(122, 162, 247, 0.1)",
                                                    }}
                                                />
                                                <Skeleton
                                                    variant="text"
                                                    width={120}
                                                    sx={{
                                                        bgcolor:
                                                            "rgba(122, 162, 247, 0.1)",
                                                    }}
                                                />
                                                <Skeleton
                                                    variant="text"
                                                    width={50}
                                                    sx={{
                                                        bgcolor:
                                                            "rgba(122, 162, 247, 0.1)",
                                                    }}
                                                />
                                                <Skeleton
                                                    variant="text"
                                                    width={70}
                                                    sx={{
                                                        bgcolor:
                                                            "rgba(122, 162, 247, 0.1)",
                                                    }}
                                                />
                                                <Box sx={{ ml: "auto" }}>
                                                    <Skeleton
                                                        variant="circular"
                                                        width={28}
                                                        height={28}
                                                        sx={{
                                                            bgcolor:
                                                                "rgba(122, 162, 247, 0.1)",
                                                        }}
                                                    />
                                                </Box>
                                            </Box>
                                        ))}
                                    </Box>
                                </Box>
                            ) : (
                                <>
                                    <Box
                                        sx={{
                                            mb: 2,
                                            display: "flex",
                                            justifyContent: "flex-end",
                                        }}
                                    >
                                        <Button
                                            variant="outlined"
                                            startIcon={<AddIcon />}
                                            onClick={handleOpenAddDevice}
                                            sx={{
                                                borderColor: "#4fd1c5",
                                                color: "#4fd1c5",
                                                "&:hover": {
                                                    borderColor: "#3dbdb2",
                                                    backgroundColor:
                                                        "rgba(79, 209, 197, 0.1)",
                                                },
                                            }}
                                        >
                                            Add Device
                                        </Button>
                                    </Box>
                                    {devices.length === 0 ? (
                                        <Box
                                            sx={{
                                                py: 6,
                                                px: 3,
                                                textAlign: "center",
                                                borderRadius: 2,
                                                border: "1px dashed rgba(122, 162, 247, 0.3)",
                                                backgroundColor:
                                                    "rgba(122, 162, 247, 0.03)",
                                            }}
                                        >
                                            <DevicesIcon
                                                sx={{
                                                    fontSize: 48,
                                                    color: "rgba(122, 162, 247, 0.3)",
                                                    mb: 2,
                                                }}
                                            />
                                            <Typography
                                                sx={{
                                                    color: "text.secondary",
                                                    mb: 1,
                                                }}
                                            >
                                                No devices configured yet
                                            </Typography>
                                            <Typography
                                                variant="caption"
                                                sx={{
                                                    color: "text.secondary",
                                                    display: "block",
                                                    mb: 2,
                                                }}
                                            >
                                                Add your first device to start
                                                syncing emulator saves
                                            </Typography>
                                            <Button
                                                variant="contained"
                                                startIcon={<AddIcon />}
                                                onClick={handleOpenAddDevice}
                                                size="small"
                                            >
                                                Add Your First Device
                                            </Button>
                                        </Box>
                                    ) : (
                                        <Box
                                            sx={{
                                                overflowX: "auto",
                                                borderRadius: 2,
                                                border: "1px solid rgba(122, 162, 247, 0.2)",
                                            }}
                                        >
                                            <Table size="small">
                                                <TableHead>
                                                    <TableRow>
                                                        <TableCell
                                                            sx={{
                                                                color: "#7aa2f7",
                                                                fontWeight: 600,
                                                                fontSize:
                                                                    "0.75rem",
                                                                letterSpacing:
                                                                    "0.05em",
                                                                textTransform:
                                                                    "uppercase",
                                                            }}
                                                        >
                                                            Name
                                                        </TableCell>
                                                        <TableCell
                                                            sx={{
                                                                color: "#7aa2f7",
                                                                fontWeight: 600,
                                                                fontSize:
                                                                    "0.75rem",
                                                                letterSpacing:
                                                                    "0.05em",
                                                                textTransform:
                                                                    "uppercase",
                                                            }}
                                                        >
                                                            IP Address
                                                        </TableCell>
                                                        <TableCell
                                                            sx={{
                                                                color: "#7aa2f7",
                                                                fontWeight: 600,
                                                                fontSize:
                                                                    "0.75rem",
                                                                letterSpacing:
                                                                    "0.05em",
                                                                textTransform:
                                                                    "uppercase",
                                                            }}
                                                        >
                                                            Port
                                                        </TableCell>
                                                        <TableCell
                                                            sx={{
                                                                color: "#7aa2f7",
                                                                fontWeight: 600,
                                                                fontSize:
                                                                    "0.75rem",
                                                                letterSpacing:
                                                                    "0.05em",
                                                                textTransform:
                                                                    "uppercase",
                                                            }}
                                                        >
                                                            Platform
                                                        </TableCell>
                                                        <TableCell
                                                            align="right"
                                                            sx={{
                                                                color: "#7aa2f7",
                                                                fontWeight: 600,
                                                                fontSize:
                                                                    "0.75rem",
                                                                letterSpacing:
                                                                    "0.05em",
                                                                textTransform:
                                                                    "uppercase",
                                                            }}
                                                        >
                                                            Actions
                                                        </TableCell>
                                                    </TableRow>
                                                </TableHead>
                                                <TableBody>
                                                    {devices.map(
                                                        (device, index) => (
                                                            <Fade
                                                                in
                                                                timeout={300}
                                                                style={{
                                                                    transitionDelay: `${index * 50}ms`,
                                                                }}
                                                                key={
                                                                    device.name as string
                                                                }
                                                            >
                                                                <TableRow
                                                                    sx={{
                                                                        transition:
                                                                            "background-color 0.15s ease",
                                                                        "&:hover":
                                                                            {
                                                                                backgroundColor:
                                                                                    "rgba(79, 209, 197, 0.05)",
                                                                            },
                                                                    }}
                                                                >
                                                                    <TableCell
                                                                        sx={{
                                                                            fontWeight: 500,
                                                                        }}
                                                                    >
                                                                        {
                                                                            device.name as string
                                                                        }
                                                                    </TableCell>
                                                                    <TableCell
                                                                        sx={{
                                                                            fontFamily:
                                                                                "monospace",
                                                                            fontSize:
                                                                                "0.85rem",
                                                                            color: "text.secondary",
                                                                        }}
                                                                    >
                                                                        {
                                                                            device.ip as string
                                                                        }
                                                                    </TableCell>
                                                                    <TableCell
                                                                        sx={{
                                                                            color: "text.secondary",
                                                                        }}
                                                                    >
                                                                        {
                                                                            device.port as number
                                                                        }
                                                                    </TableCell>
                                                                    <TableCell>
                                                                        <Box
                                                                            sx={{
                                                                                display:
                                                                                    "flex",
                                                                                alignItems:
                                                                                    "center",
                                                                                gap: 1,
                                                                            }}
                                                                        >
                                                                            <OsIcon
                                                                                os={
                                                                                    device.os as string
                                                                                }
                                                                            />
                                                                            <Typography
                                                                                variant="body2"
                                                                                sx={{
                                                                                    textTransform:
                                                                                        "capitalize",
                                                                                }}
                                                                            >
                                                                                {osOptions.find(
                                                                                    (
                                                                                        o,
                                                                                    ) =>
                                                                                        o.value ===
                                                                                        device.os,
                                                                                )
                                                                                    ?.label ||
                                                                                    String(
                                                                                        device.os,
                                                                                    )}
                                                                            </Typography>
                                                                        </Box>
                                                                    </TableCell>
                                                                    <TableCell align="right">
                                                                        <IconButton
                                                                            size="small"
                                                                            onClick={() =>
                                                                                handleOpenEditDevice(
                                                                                    device,
                                                                                )
                                                                            }
                                                                            sx={{
                                                                                color: "#7aa2f7",
                                                                                transition:
                                                                                    "color 0.15s ease",
                                                                                "&:hover":
                                                                                    {
                                                                                        color: "#4fd1c5",
                                                                                    },
                                                                            }}
                                                                        >
                                                                            <EditIcon fontSize="small" />
                                                                        </IconButton>
                                                                        <IconButton
                                                                            size="small"
                                                                            onClick={() => {
                                                                                setDeviceToDelete(
                                                                                    device.name as string,
                                                                                );
                                                                                setDeleteDialogOpen(
                                                                                    true,
                                                                                );
                                                                            }}
                                                                            sx={{
                                                                                color: "#f28fad",
                                                                                transition:
                                                                                    "opacity 0.15s ease",
                                                                                "&:hover":
                                                                                    {
                                                                                        opacity: 0.8,
                                                                                    },
                                                                            }}
                                                                        >
                                                                            <DeleteIcon fontSize="small" />
                                                                        </IconButton>
                                                                    </TableCell>
                                                                </TableRow>
                                                            </Fade>
                                                        ),
                                                    )}
                                                </TableBody>
                                            </Table>
                                        </Box>
                                    )}
                                </>
                            )}
                        </AccordionDetails>
                    </Accordion>
                </Fade>

                {/* Server Configuration */}
                <Fade in timeout={500} style={{ transitionDelay: "200ms" }}>
                    <Accordion sx={accordionSx}>
                        <AccordionSummary
                            expandIcon={
                                <ExpandMoreIcon sx={{ color: "#7aa2f7" }} />
                            }
                        >
                            <Box
                                sx={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 1.5,
                                }}
                            >
                                <SportsEsportsIcon
                                    sx={{
                                        color: "#f28fad",
                                        fontSize: "1.3rem",
                                    }}
                                />
                                <Box>
                                    <Typography
                                        sx={{
                                            fontFamily:
                                                '"Unbounded", sans-serif',
                                            fontWeight: 600,
                                            fontSize: "1.1rem",
                                        }}
                                    >
                                        Server Paths
                                    </Typography>
                                    <Typography
                                        variant="caption"
                                        sx={{ color: "text.secondary" }}
                                    >
                                        Configure emulator save locations on the
                                        server
                                    </Typography>
                                </Box>
                            </Box>
                        </AccordionSummary>
                        <AccordionDetails>
                            {serverLoading ? (
                                <Box>
                                    {[1, 2, 3].map((group) => (
                                        <Box key={group} sx={{ mb: 3 }}>
                                            <Skeleton
                                                variant="text"
                                                width={100}
                                                height={20}
                                                sx={{
                                                    bgcolor:
                                                        "rgba(122, 162, 247, 0.1)",
                                                    mb: 1.5,
                                                }}
                                            />
                                            <Box
                                                sx={{
                                                    display: "grid",
                                                    gap: 2,
                                                    gridTemplateColumns: {
                                                        xs: "1fr",
                                                        md: "1fr 1fr",
                                                    },
                                                }}
                                            >
                                                {[1, 2, 3, 4].map((i) => (
                                                    <Skeleton
                                                        key={i}
                                                        variant="rounded"
                                                        height={56}
                                                        sx={{
                                                            bgcolor:
                                                                "rgba(122, 162, 247, 0.1)",
                                                        }}
                                                    />
                                                ))}
                                            </Box>
                                        </Box>
                                    ))}
                                </Box>
                            ) : (
                                <>
                                    {serverFieldGroups.map(
                                        (group, groupIndex) => (
                                            <Box
                                                key={group.title}
                                                sx={{
                                                    mb:
                                                        groupIndex <
                                                        serverFieldGroups.length -
                                                            1
                                                            ? 3
                                                            : 0,
                                                }}
                                            >
                                                <Typography sx={groupHeaderSx}>
                                                    {group.title}
                                                </Typography>
                                                <Box
                                                    sx={{
                                                        display: "grid",
                                                        gap: 2,
                                                        gridTemplateColumns: {
                                                            xs: "1fr",
                                                            md: "1fr 1fr",
                                                        },
                                                    }}
                                                >
                                                    {group.fields.map(
                                                        (field) => (
                                                            <TextField
                                                                key={field.key}
                                                                label={
                                                                    field.label
                                                                }
                                                                value={
                                                                    (serverConfig[
                                                                        field
                                                                            .key
                                                                    ] as string) ||
                                                                    ""
                                                                }
                                                                onChange={(e) =>
                                                                    handleServerFieldChange(
                                                                        field.key,
                                                                        e.target
                                                                            .value,
                                                                    )
                                                                }
                                                                helperText={
                                                                    field.description
                                                                }
                                                                fullWidth
                                                                size="small"
                                                                sx={inputSx}
                                                            />
                                                        ),
                                                    )}
                                                </Box>
                                            </Box>
                                        ),
                                    )}
                                    <Box
                                        sx={{
                                            mt: 3,
                                            display: "flex",
                                            justifyContent: "flex-end",
                                        }}
                                    >
                                        <Button
                                            variant="contained"
                                            startIcon={<SaveIcon />}
                                            onClick={handleSaveServerConfig}
                                            disabled={serverSaving}
                                        >
                                            {serverSaving
                                                ? "Saving..."
                                                : "Save Server Config"}
                                        </Button>
                                    </Box>
                                </>
                            )}
                        </AccordionDetails>
                    </Accordion>
                </Fade>

                {/* Device Add/Edit Dialog */}
                <Dialog
                    open={deviceDialogOpen}
                    onClose={() => setDeviceDialogOpen(false)}
                    maxWidth="md"
                    fullWidth
                    slotProps={{
                        paper: {
                            sx: {
                                backgroundColor: "rgba(17, 24, 37, 0.98)",
                                border: "1px solid rgba(122, 162, 247, 0.3)",
                                borderRadius: 3,
                            },
                        },
                    }}
                >
                    <DialogTitle
                        sx={{
                            fontFamily: '"Unbounded", sans-serif',
                            fontWeight: 600,
                        }}
                    >
                        {editingDevice ? "Edit Device" : "Add Device"}
                    </DialogTitle>
                    <DialogContent>
                        <Box sx={{ pt: 1 }}>
                            <Typography sx={groupHeaderSx}>
                                Connection Details
                            </Typography>
                            <Box
                                sx={{
                                    display: "grid",
                                    gap: 2,
                                    gridTemplateColumns: {
                                        xs: "1fr",
                                        sm: "1fr 1fr",
                                    },
                                    mb: 3,
                                }}
                            >
                                {deviceBaseFields.map((field) => (
                                    <TextField
                                        key={field.key}
                                        label={field.label}
                                        value={
                                            (deviceForm[field.key] as
                                                | string
                                                | number) ?? ""
                                        }
                                        onChange={(e) =>
                                            handleDeviceFormChange(
                                                field.key,
                                                field.type === "number"
                                                    ? Number(e.target.value)
                                                    : e.target.value,
                                            )
                                        }
                                        required={field.required}
                                        type={field.type || "text"}
                                        fullWidth
                                        size="small"
                                        sx={inputSx}
                                    />
                                ))}
                                <FormControl
                                    fullWidth
                                    size="small"
                                    sx={inputSx}
                                >
                                    <InputLabel>Operating System</InputLabel>
                                    <Select
                                        value={
                                            (deviceForm.os as string) || "linux"
                                        }
                                        label="Operating System"
                                        onChange={(e) =>
                                            handleDeviceFormChange(
                                                "os",
                                                e.target.value,
                                            )
                                        }
                                    >
                                        {osOptions.map((option) => (
                                            <MenuItem
                                                key={option.value}
                                                value={option.value}
                                            >
                                                <Box
                                                    sx={{
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: 1,
                                                    }}
                                                >
                                                    <OsIcon os={option.value} />
                                                    {option.label}
                                                </Box>
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                            </Box>

                            {/* Grouped Emulator Paths */}
                            {deviceEmulatorGroups.map((group, groupIndex) => (
                                <Box
                                    key={group.title}
                                    sx={{
                                        mb:
                                            groupIndex <
                                            deviceEmulatorGroups.length - 1
                                                ? 3
                                                : 0,
                                    }}
                                >
                                    <Typography sx={groupHeaderSx}>
                                        {group.title} Paths
                                    </Typography>
                                    <Box
                                        sx={{
                                            display: "grid",
                                            gap: 2,
                                            gridTemplateColumns: {
                                                xs: "1fr",
                                                sm: "1fr 1fr",
                                            },
                                        }}
                                    >
                                        {group.fields.map((field) => (
                                            <TextField
                                                key={field.key}
                                                label={field.label}
                                                value={
                                                    (deviceForm[
                                                        field.key
                                                    ] as string) || ""
                                                }
                                                onChange={(e) =>
                                                    handleDeviceFormChange(
                                                        field.key,
                                                        e.target.value,
                                                    )
                                                }
                                                fullWidth
                                                size="small"
                                                sx={inputSx}
                                            />
                                        ))}
                                    </Box>
                                </Box>
                            ))}
                        </Box>
                    </DialogContent>
                    <DialogActions sx={{ px: 3, pb: 3 }}>
                        <Button
                            onClick={() => setDeviceDialogOpen(false)}
                            sx={{ color: "text.secondary" }}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="contained"
                            onClick={handleSaveDevice}
                            disabled={deviceSaving}
                        >
                            {deviceSaving
                                ? "Saving..."
                                : editingDevice
                                  ? "Update"
                                  : "Add"}
                        </Button>
                    </DialogActions>
                </Dialog>

                {/* Delete Confirmation Dialog */}
                <Dialog
                    open={deleteDialogOpen}
                    onClose={() => setDeleteDialogOpen(false)}
                    slotProps={{
                        paper: {
                            sx: {
                                backgroundColor: "rgba(17, 24, 37, 0.98)",
                                border: "1px solid rgba(242, 143, 173, 0.3)",
                                borderRadius: 3,
                            },
                        },
                    }}
                >
                    <DialogTitle sx={{ fontFamily: '"Unbounded", sans-serif' }}>
                        Delete Device
                    </DialogTitle>
                    <DialogContent>
                        <Typography>
                            Are you sure you want to delete &quot;
                            {deviceToDelete}&quot;? This action cannot be
                            undone.
                        </Typography>
                    </DialogContent>
                    <DialogActions sx={{ px: 3, pb: 3 }}>
                        <Button
                            onClick={() => setDeleteDialogOpen(false)}
                            sx={{ color: "text.secondary" }}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="contained"
                            onClick={handleConfirmDelete}
                            sx={{
                                backgroundColor: "#f28fad",
                                color: "#0a0d14",
                                fontWeight: 600,
                                "&:hover": { backgroundColor: "#e07a9a" },
                            }}
                        >
                            Delete
                        </Button>
                    </DialogActions>
                </Dialog>

                {/* Snackbar for notifications */}
                <Snackbar
                    open={snackbar.open}
                    autoHideDuration={4000}
                    onClose={() =>
                        setSnackbar((prev) => ({ ...prev, open: false }))
                    }
                    anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                >
                    <Alert
                        severity={snackbar.severity}
                        onClose={() =>
                            setSnackbar((prev) => ({ ...prev, open: false }))
                        }
                        sx={{
                            backgroundColor:
                                snackbar.severity === "success"
                                    ? "rgba(79, 209, 197, 0.15)"
                                    : "rgba(242, 143, 173, 0.15)",
                            border: "1px solid",
                            borderColor:
                                snackbar.severity === "success"
                                    ? "rgba(79, 209, 197, 0.4)"
                                    : "rgba(242, 143, 173, 0.4)",
                            color:
                                snackbar.severity === "success"
                                    ? "#4fd1c5"
                                    : "#f28fad",
                        }}
                    >
                        {snackbar.message}
                    </Alert>
                </Snackbar>
            </Container>
        </Box>
    );
}
