import {
  Alert,
  Box,
  Button,
  Center,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'
import { TbAlertTriangle, TbLogout, TbShieldOff } from 'react-icons/tb'
import { useLogout } from '@/frontend/hooks/useAuth'
import { ThemeToggle } from '@/frontend/components/ThemeToggle'

export const Route = createFileRoute('/blocked')({
  component: BlockedPage,
})

function BlockedPage() {
  const logout = useLogout()

  return (
    <Center mih="100vh" style={{ position: 'relative' }}>
      <Box style={{ position: 'absolute', top: 16, right: 16 }}>
        <ThemeToggle />
      </Box>
      <Paper shadow="md" p="xl" radius="md" w={460} withBorder>
        <Stack align="center" gap="lg">
          <ThemeIcon color="red" size={72} radius="xl" variant="light">
            <TbShieldOff size={40} />
          </ThemeIcon>

          <Title order={2} ta="center">Akun Diblokir</Title>

          <Text c="dimmed" ta="center" size="sm">
            Akun Anda telah diblokir oleh administrator. Anda tidak dapat mengakses
            halaman manapun di aplikasi ini sampai akun Anda dibuka kembali.
          </Text>

          <Alert
            icon={<TbAlertTriangle size={18} />}
            color="red"
            variant="light"
            w="100%"
          >
            <Text size="sm">
              <strong>Apa yang terjadi?</strong>
              <br />
              Administrator telah menonaktifkan akses Anda. Ini bisa terjadi karena pelanggaran
              ketentuan penggunaan atau alasan keamanan lainnya.
            </Text>
          </Alert>

          <Alert
            icon={<TbAlertTriangle size={18} />}
            color="blue"
            variant="light"
            w="100%"
          >
            <Text size="sm">
              <strong>Apa yang harus dilakukan?</strong>
              <br />
              Hubungi administrator untuk informasi lebih lanjut atau untuk mengajukan
              pembukaan blokir akun Anda.
            </Text>
          </Alert>

          <Button
            fullWidth
            color="red"
            variant="light"
            leftSection={<TbLogout size={18} />}
            onClick={() => logout.mutate()}
            loading={logout.isPending}
          >
            Logout
          </Button>
        </Stack>
      </Paper>
    </Center>
  )
}
