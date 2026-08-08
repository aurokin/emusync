import type { Route } from "./+types/home";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import AndroidIcon from "@mui/icons-material/Android";
import AppleIcon from "@mui/icons-material/Apple";
import ComputerIcon from "@mui/icons-material/Computer";
import PhoneIphoneIcon from "@mui/icons-material/PhoneIphone";
import DesktopWindowsIcon from "@mui/icons-material/DesktopWindows";
import TerminalIcon from "@mui/icons-material/Terminal";
import { useDevices } from "~/contexts/DeviceContext";
import { EmulatorActionForm } from "~/components/EmulatorActionForm";
import { capitalize } from "~/utilities/utils";

export function meta(_args: Route.MetaArgs) {
    return [
        { title: "EmuSync" },
        {
            name: "description",
            content:
                "Application for syncing emulation save games with the server or the device!",
        },
    ];
}

function getDeviceIcon(os: string) {
    const osLower = os.toLowerCase();
    const iconSx = {
        fontSize: 22,
        color: "#7aa2f7",
        filter: "drop-shadow(0 6px 10px rgba(122, 162, 247, 0.35))",
    };

    if (osLower.includes("android")) {
        return <AndroidIcon sx={iconSx} />;
    } else if (osLower.includes("ios")) {
        return <PhoneIphoneIcon sx={iconSx} />;
    } else if (osLower.includes("windows")) {
        return <DesktopWindowsIcon sx={iconSx} />;
    } else if (osLower.includes("mac") || osLower.includes("darwin")) {
        return <AppleIcon sx={iconSx} />;
    } else if (osLower.includes("linux")) {
        return <TerminalIcon sx={iconSx} />;
    } else {
        return <ComputerIcon sx={iconSx} />;
    }
}

function TerminalLoader() {
    return (
        <Box
            sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                color: "text.secondary",
                mb: 3,
            }}
        >
            <Box
                component="span"
                sx={{
                    display: "inline-flex",
                    gap: "6px",
                }}
            >
                {[0, 1, 2].map((i) => (
                    <Box
                        key={i}
                        sx={{
                            width: 8,
                            height: 8,
                            borderRadius: 999,
                            backgroundColor: "#4fd1c5",
                            animation: "loader-pulse 1.4s ease-in-out infinite",
                            animationDelay: `${i * 0.2}s`,
                            "@keyframes loader-pulse": {
                                "0%, 80%, 100%": {
                                    transform: "scale(0.7)",
                                    opacity: 0.5,
                                },
                                "40%": {
                                    transform: "scale(1)",
                                    opacity: 1,
                                    boxShadow:
                                        "0 0 10px rgba(79, 209, 197, 0.6)",
                                },
                            },
                        }}
                    />
                ))}
            </Box>
            <Typography
                variant="caption"
                sx={{
                    color: "#4fd1c5",
                    letterSpacing: "0.14em",
                    fontSize: "0.65rem",
                }}
            >
                SYNCING DEVICES
            </Typography>
        </Box>
    );
}

export default function Home() {
    const {
        devices,
        loading,
        error,
        selectedDevice,
        setSelectedDevice,
        requestInProgress,
    } = useDevices();

    return (
        <Container maxWidth="lg" sx={{ py: { xs: 4, md: 6 } }}>
            <Box sx={{ mb: 4 }}>
                <Typography
                    variant="caption"
                    sx={{
                        color: "#7aa2f7",
                        letterSpacing: "0.2em",
                        display: "block",
                        mb: 1,
                    }}
                >
                    DEVICE CONTROL
                </Typography>
                <Typography
                    variant="h3"
                    sx={{
                        fontFamily: '"Unbounded", sans-serif',
                        fontWeight: 600,
                        mb: 1,
                    }}
                >
                    Choose a device to sync
                </Typography>
                <Typography
                    sx={{
                        color: "text.secondary",
                        maxWidth: 520,
                        fontSize: "0.95rem",
                    }}
                >
                    Select a connected device to configure emulator actions and
                    manage the latest save-state transfers.
                </Typography>
            </Box>

            {loading && <TerminalLoader />}

            {error && (
                <Box
                    sx={{
                        p: 2.5,
                        borderRadius: 3,
                        border: "1px solid rgba(242, 143, 173, 0.4)",
                        backgroundColor: "rgba(242, 143, 173, 0.1)",
                        mb: 3,
                    }}
                >
                    <Typography
                        sx={{
                            color: "#f28fad",
                            fontSize: "0.9rem",
                            fontWeight: 600,
                        }}
                    >
                        Unable to load devices
                    </Typography>
                    <Typography
                        sx={{
                            color: "text.secondary",
                            fontSize: "0.8rem",
                        }}
                    >
                        {error}
                    </Typography>
                </Box>
            )}

            {!loading && !error && devices.length === 0 && (
                <Box
                    sx={{
                        p: 3,
                        borderRadius: 3,
                        border: "1px dashed rgba(122, 162, 247, 0.35)",
                        textAlign: "center",
                        color: "text.secondary",
                        mb: 3,
                    }}
                >
                    <Typography sx={{ fontSize: "0.9rem" }}>
                        No devices found. Connect a device and refresh.
                    </Typography>
                </Box>
            )}

            {!loading && !error && devices.length > 0 && (
                <Box
                    sx={{
                        display: "grid",
                        gap: 2.5,
                        gridTemplateColumns: {
                            xs: "1fr",
                            sm: "repeat(2, 1fr)",
                            md: "repeat(3, 1fr)",
                        },
                    }}
                >
                    {devices.map((device) => {
                        const isSelected = selectedDevice === device.name;
                        return (
                            <Box
                                key={device.name}
                                onClick={() => {
                                    // Deliberately not gated on
                                    // requestInProgress: a stuck flag used to
                                    // make the device list unclickable, and a
                                    // reload was the only escape. The server
                                    // rejects a concurrent sync with 409, so
                                    // switching devices here is safe.
                                    setSelectedDevice(
                                        isSelected ? null : device.name,
                                    );
                                }}
                                sx={{
                                    cursor: "pointer",
                                    // Dim the others during a sync as a hint
                                    // that one is running, but they stay
                                    // clickable — see the onClick note above.
                                    opacity:
                                        requestInProgress && !isSelected
                                            ? 0.6
                                            : 1,
                                    position: "relative",
                                    borderRadius: 3,
                                    overflow: "hidden",
                                    backgroundColor: "rgba(17, 24, 37, 0.82)",
                                    border: "1px solid",
                                    borderColor: isSelected
                                        ? "rgba(79, 209, 197, 0.6)"
                                        : "rgba(122, 162, 247, 0.2)",
                                    boxShadow: isSelected
                                        ? "0 18px 40px rgba(6, 9, 16, 0.35)"
                                        : "0 10px 28px rgba(6, 9, 16, 0.25)",
                                    transition: "all 0.2s ease",
                                    "&:hover": {
                                        borderColor: requestInProgress
                                            ? undefined
                                            : "rgba(79, 209, 197, 0.5)",
                                        transform: requestInProgress
                                            ? undefined
                                            : "translateY(-4px)",
                                    },
                                }}
                            >
                                <Box
                                    sx={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 1,
                                        px: 2,
                                        py: 1.2,
                                        borderBottom: "1px solid",
                                        borderColor:
                                            "rgba(122, 162, 247, 0.15)",
                                        backgroundColor:
                                            "rgba(10, 14, 22, 0.6)",
                                        borderTopLeftRadius: "inherit",
                                        borderTopRightRadius: "inherit",
                                    }}
                                >
                                    <Box
                                        sx={{
                                            display: "flex",
                                            gap: "6px",
                                        }}
                                    >
                                        {["#f6c177", "#7aa2f7", "#4fd1c5"].map(
                                            (color) => (
                                                <Box
                                                    key={color}
                                                    sx={{
                                                        width: 6,
                                                        height: 6,
                                                        borderRadius: 999,
                                                        backgroundColor: color,
                                                        opacity: 0.8,
                                                    }}
                                                />
                                            ),
                                        )}
                                    </Box>
                                    <Typography
                                        variant="caption"
                                        sx={{
                                            color: isSelected
                                                ? "#4fd1c5"
                                                : "text.secondary",
                                            fontSize: "0.6rem",
                                            letterSpacing: "0.2em",
                                            ml: "auto",
                                        }}
                                    >
                                        {isSelected ? "ACTIVE" : "DEVICE"}
                                    </Typography>
                                </Box>

                                <Box sx={{ p: 2.5 }}>
                                    <Box
                                        sx={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 1.5,
                                            mb: 1.5,
                                        }}
                                    >
                                        {getDeviceIcon(device.os)}
                                        <Typography
                                            sx={{
                                                fontSize: "1rem",
                                                fontWeight: 600,
                                                color: isSelected
                                                    ? "#4fd1c5"
                                                    : "text.primary",
                                            }}
                                        >
                                            {device.name}
                                        </Typography>
                                    </Box>

                                    <Box
                                        sx={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 1,
                                            mb: 2,
                                        }}
                                    >
                                        <Typography
                                            variant="caption"
                                            sx={{
                                                color: "#7aa2f7",
                                                fontSize: "0.6rem",
                                                letterSpacing: "0.14em",
                                            }}
                                        >
                                            OS
                                        </Typography>
                                        <Typography
                                            sx={{
                                                color: "text.secondary",
                                                fontSize: "0.8rem",
                                            }}
                                        >
                                            {capitalize(device.os)}
                                        </Typography>
                                    </Box>

                                    <Box>
                                        <Typography
                                            variant="caption"
                                            sx={{
                                                color: "#7aa2f7",
                                                fontSize: "0.6rem",
                                                letterSpacing: "0.14em",
                                                display: "block",
                                                mb: 1,
                                            }}
                                        >
                                            EMULATORS
                                        </Typography>
                                        <Box
                                            sx={{
                                                display: "flex",
                                                flexWrap: "wrap",
                                                gap: 0.75,
                                            }}
                                        >
                                            {device.emulatorsEnabled.map(
                                                (emulator) => (
                                                    <Box
                                                        key={emulator}
                                                        sx={{
                                                            px: 1.2,
                                                            py: 0.4,
                                                            borderRadius: 999,
                                                            fontSize: "0.65rem",
                                                            fontWeight: 600,
                                                            letterSpacing:
                                                                "0.08em",
                                                            textTransform:
                                                                "uppercase",
                                                            border: "1px solid",
                                                            borderColor:
                                                                isSelected
                                                                    ? "rgba(79, 209, 197, 0.5)"
                                                                    : "rgba(122, 162, 247, 0.35)",
                                                            color: isSelected
                                                                ? "#4fd1c5"
                                                                : "#7aa2f7",
                                                            backgroundColor:
                                                                isSelected
                                                                    ? "rgba(79, 209, 197, 0.12)"
                                                                    : "rgba(122, 162, 247, 0.12)",
                                                        }}
                                                    >
                                                        {capitalize(emulator)}
                                                    </Box>
                                                ),
                                            )}
                                        </Box>
                                    </Box>
                                </Box>

                                {isSelected && (
                                    <Box
                                        sx={{
                                            position: "absolute",
                                            bottom: 0,
                                            left: 0,
                                            right: 0,
                                            height: "3px",
                                            background:
                                                "linear-gradient(90deg, transparent 0%, rgba(79, 209, 197, 0.8) 45%, rgba(122, 162, 247, 0.7) 70%, transparent 100%)",
                                        }}
                                    />
                                )}
                            </Box>
                        );
                    })}
                </Box>
            )}

            <EmulatorActionForm />
        </Container>
    );
}
