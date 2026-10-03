import React from 'react';
import type { ActiveTab } from '../layout/AppLayout';
import { IconHardHat, IconShield, IconAlertTriangle } from '../icons';

export interface LiveMonitoringViewProps {
  onNavigate: (tab: ActiveTab) => void;
}

export function LiveMonitoringView({ onNavigate }: LiveMonitoringViewProps) {
  return (
    <div className="space-y-6 max-w-[1202px] mx-auto text-[#182232] pb-10">
      {/* Header & Concise Scope Notice */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-[#2F3437] tracking-tight">
          Giám sát An toàn (Live Monitoring)
        </h1>
        <p className="text-sm text-[#6B6B6B] mt-2 max-w-3xl leading-relaxed">
          Chưa tích hợp luồng trực tiếp đa camera đồng thời (No combined live multi-camera feed).
          Khung hình xem trước chỉ hỗ trợ phạm vi mô hình{' '}
          <strong>Mũ bảo hộ &amp; Áo phản quang</strong> (Hard Hat &amp; Safety Vest) và quan sát
          vùng hạn chế; không suy đoán danh tính công nhân hoặc thẩm quyền ra vào từ video xem
          trước.
        </p>
      </div>

      {/* Three Direct Subsystem Navigation Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
        {/* Card 1: PPE Monitoring */}
        <div className="flex flex-col justify-between rounded-lg border border-[#EAEAEA] bg-white p-5 shadow-xs hover:border-[#2F3437]/20 transition-colors">
          <div className="space-y-3">
            <div className="rounded-md bg-amber-50 p-2.5 text-[#D97706] w-fit">
              <IconHardHat className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#111111]">
                Giám sát Trang bị Bảo hộ (PPE Monitoring)
              </h2>
              <p className="mt-1.5 text-xs leading-5 text-[#6B6B6B]">
                Xem trước phát hiện Mũ bảo hộ và Áo phản quang qua luồng WebSocket camera thời gian
                thực hoặc video chẩn đoán theo từng đối tượng.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('ppe')}
            className="mt-5 w-full rounded-md border border-[#EAEAEA] bg-[#F7F6F3] px-3 py-2 text-xs font-bold text-[#2F3437] hover:bg-[#EAEAEA] hover:text-[#111111] transition-colors cursor-pointer"
          >
            Vào Giám sát Trang bị Bảo hộ
          </button>
        </div>

        {/* Card 2: Restricted Zones */}
        <div className="flex flex-col justify-between rounded-lg border border-[#EAEAEA] bg-white p-5 shadow-xs hover:border-[#2F3437]/20 transition-colors">
          <div className="space-y-3">
            <div className="rounded-md bg-red-50 p-2.5 text-[#DF2225] w-fit">
              <IconShield className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#111111]">
                Giám sát Khu vực Hạn chế (Restricted Zones)
              </h2>
              <p className="mt-1.5 text-xs leading-5 text-[#6B6B6B]">
                Cấu hình đa giác vùng nguy hiểm trực tiếp trên video và quan sát các sự kiện người
                đi vào khu vực cấm vận hành máy móc theo từng phân vùng.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('zones')}
            className="mt-5 w-full rounded-md border border-[#EAEAEA] bg-[#F7F6F3] px-3 py-2 text-xs font-bold text-[#2F3437] hover:bg-[#EAEAEA] hover:text-[#111111] transition-colors cursor-pointer"
          >
            Vào Giám sát Khu vực Hạn chế
          </button>
        </div>

        {/* Card 3: Safety Alerts */}
        <div className="flex flex-col justify-between rounded-lg border border-[#EAEAEA] bg-white p-5 shadow-xs hover:border-[#2F3437]/20 transition-colors">
          <div className="space-y-3">
            <div className="rounded-md bg-stone-100 p-2.5 text-[#111111] w-fit">
              <IconAlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#111111]">
                Cảnh báo An toàn (Safety Alerts)
              </h2>
              <p className="mt-1.5 text-xs leading-5 text-[#6B6B6B]">
                Tra cứu danh sách cảnh báo đã lưu trữ từ Backend API, kiểm tra ảnh bằng chứng và
                thực hiện quy trình duyệt danh tính có kiểm toán.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('incidents')}
            className="mt-5 w-full rounded-md border border-[#EAEAEA] bg-[#F7F6F3] px-3 py-2 text-xs font-bold text-[#2F3437] hover:bg-[#EAEAEA] hover:text-[#111111] transition-colors cursor-pointer"
          >
            Vào Cảnh báo An toàn
          </button>
        </div>
      </div>
    </div>
  );
}
