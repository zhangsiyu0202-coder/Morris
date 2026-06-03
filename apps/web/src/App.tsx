import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { DashboardPage } from "@/pages/DashboardPage";
import { InterviewPreviewPage } from "@/pages/InterviewPreviewPage";
import { LoginPage } from "@/pages/LoginPage";
import { MorisPage } from "@/pages/MorisPage";
import { ProjectPage } from "@/pages/ProjectPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { SurveyPage } from "@/pages/SurveyPage";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/auth/login" element={<LoginPage />} />
      <Route path="/interview-preview" element={<InterviewPreviewPage />} />
      <Route element={<AppShell />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/moris" element={<MorisPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/projects/:projectId" element={<ProjectPage />} />
        <Route path="/projects/:projectId/surveys/:surveyId" element={<SurveyPage />} />
      </Route>
    </Routes>
  );
}
