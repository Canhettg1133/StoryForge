import React, { useEffect, useState } from 'react';
import { Outlet, useParams, useNavigate } from 'react-router-dom';
import useProjectStore from '../../stores/projectStore';
import { Loader2 } from 'lucide-react';
import useMobileLayout from '../../hooks/useMobileLayout';
import MobileProjectShell from '../mobile/MobileProjectShell';

export default function ProjectLayout() {
    const { projectId } = useParams();
    const navigate = useNavigate();
    const { currentProject, loadProject, loading } = useProjectStore();
    const [init, setInit] = useState(false);
    const isMobileLayout = useMobileLayout(900);

    useEffect(() => {
        const initProject = async () => {
            if (!projectId) return;

            const id = Number(projectId);
            if (isNaN(id)) {
                navigate('/');
                return;
            }

            // If store is empty (reload) OR we navigated to a different project
            if (!currentProject || currentProject.id !== id) {
                try {
                    await loadProject(id);
                } catch (err) {
                    console.error('Failed to load project:', err);
                    navigate('/');
                }
            }
            setInit(true);
        };

        initProject();
    }, [projectId, currentProject?.id, loadProject, navigate]);

    if (!init || loading || (!currentProject && projectId)) {
        return (
            <div style={{ display: 'flex', height: '100%', width: '100%', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px', color: 'var(--color-text-secondary)' }}>
                <Loader2 size={32} className="spin" />
                <p>Đang tải dữ liệu truyện...</p>
            </div>
        );
    }

    if (isMobileLayout) {
        return (
            <MobileProjectShell>
                <Outlet />
            </MobileProjectShell>
        );
    }

    return <Outlet />;
}
