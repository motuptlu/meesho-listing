/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion } from "motion/react";

export default function App() {
  return (
    <div className="bg-[#F5F5F5] min-h-screen flex overflow-hidden font-sans text-[#333333]">
      {/* Editorial Sidebar */}
      <motion.div 
        initial={{ x: -100, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        className="hidden lg:flex w-1/3 h-screen bg-white border-r border-gray-200 p-12 flex-col justify-between"
      >
        <div className="space-y-8">
          <div className="w-12 h-12 bg-gradient-to-br from-[#9C27B0] to-[#E91E63] rounded-xl flex items-center justify-center text-white text-2xl shadow-lg">🛍️</div>
          <h1 className="text-5xl font-bold leading-tight tracking-tight text-[#141414]">
            Meesho<br/>
            <span className="text-[#9C27B0]">Auto Lister</span>
          </h1>
          <p className="text-lg text-gray-500 leading-relaxed max-w-xs italic">
            Accelerate your seller workflow with AI-powered image analysis and automated form filling.
          </p>
        </div>

        <div className="space-y-6">
          <div className="flex items-center gap-4 group">
            <div className="w-8 h-8 rounded-full border border-[#9C27B0] flex items-center justify-center text-[#9C27B0] font-bold text-xs">01</div>
            <span className="text-xs uppercase tracking-widest font-semibold text-gray-400">Upload Images</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="w-8 h-8 rounded-full border border-[#9C27B0] flex items-center justify-center text-[#9C27B0] font-bold text-xs">02</div>
            <span className="text-xs uppercase tracking-widest font-semibold text-gray-400">AI Analysis</span>
          </div>
          <div className="flex items-center gap-4 opacity-30">
            <div className="w-8 h-8 rounded-full border border-gray-300 flex items-center justify-center font-bold text-xs">03</div>
            <span className="text-xs uppercase tracking-widest font-semibold">Auto Fill Form</span>
          </div>
        </div>

        <div className="pt-8 border-t border-gray-100">
          <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold mb-2">Powered By</p>
          <p className="text-sm font-bold text-gray-700">Google Gemini 1.5 Flash</p>
        </div>
      </motion.div>

      {/* Preview Stage */}
      <div className="flex-1 h-screen flex items-center justify-center p-8 bg-[#E5E7EB]">
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="w-[420px] h-[680px] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col border border-gray-100 ring-8 ring-black/5"
        >
          {/* Header Mockup */}
          <div className="bg-gradient-to-r from-[#9C27B0] to-[#E91E63] p-4 text-white shrink-0">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🛍️</span>
              <div>
                <h2 className="text-lg font-bold leading-none">Meesho Auto Lister</h2>
                <p className="text-[10px] opacity-80 uppercase tracking-wider mt-1">V1.0.4 • Powered by AI</p>
              </div>
            </div>
          </div>

          <div className="bg-green-50 px-4 py-2 flex items-center gap-2 border-b border-green-100 shrink-0">
            <div className="w-2 h-2 rounded-full bg-[#4CAF50] shadow-[0_0_8px_#4CAF50]"></div>
            <span className="text-[11px] font-medium text-[#4CAF50] uppercase tracking-wide">Active on supplier.meesho.com</span>
          </div>

          <nav className="flex bg-white border-b border-gray-100 shrink-0">
            <button className="flex-1 py-3 text-[10px] font-bold uppercase tracking-wider text-[#9C27B0] border-b-2 border-[#9C27B0]">New Listing</button>
            <button className="flex-1 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-400">History</button>
          </nav>

          <div className="flex-1 overflow-y-auto p-4 space-y-5 custom-scrollbar bg-white">
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Upload Assets</label>
              <div className="border-2 border-dashed border-[#9C27B0]/30 rounded-xl p-6 bg-purple-50/30 flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-purple-50 transition-colors">
                <span className="text-3xl opacity-60">📸</span>
                <p className="text-xs font-semibold text-[#9C27B0]">Drag or Click to Upload</p>
                <p className="text-[9px] text-gray-400">Max 5 images • JPEG, PNG</p>
              </div>
            </div>

            <div className="grid grid-cols-5 gap-2">
              {[1, 2].map((i) => (
                <div key={i} className="relative aspect-square bg-gray-100 rounded-lg overflow-hidden border border-gray-200">
                  <div className="absolute top-0.5 right-0.5 w-4 h-4 bg-[#F44336] rounded-full flex items-center justify-center text-white text-[8px] cursor-pointer">✕</div>
                  <div className="w-full h-full bg-[#D1D5DB] flex items-center justify-center text-[10px] italic text-gray-400 font-medium">IMG{i}</div>
                </div>
              ))}
            </div>

            <div className="space-y-3 pt-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Analysis Preview</label>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-[9px] text-gray-500 mb-1 block uppercase font-bold">Product Name</label>
                  <div className="w-full border border-gray-200 rounded-md p-2 text-xs bg-gray-50 text-gray-700">Premium Silk Saree with Embroidered Borders</div>
                </div>
                <div>
                  <label className="text-[9px] text-gray-500 mb-1 block uppercase font-bold">Category</label>
                  <div className="w-full border border-gray-200 rounded-md p-2 text-xs bg-gray-50">Women Ethnic</div>
                </div>
                <div>
                  <label className="text-[9px] text-gray-500 mb-1 block uppercase font-bold">Selling Price</label>
                  <div className="w-full border border-gray-200 rounded-md p-2 text-xs bg-gray-50">₹999</div>
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 bg-gray-50 border-t border-gray-100 flex flex-col gap-2 shrink-0">
            <button className="w-full bg-[#9C27B0] text-white py-3 rounded-xl font-bold text-sm shadow-lg shadow-purple-200 hover:brightness-110 active:scale-[0.98] transition-all">
              Analyze with AI
            </button>
            <button className="w-full bg-[#4CAF50] text-white py-3 rounded-xl font-bold text-sm shadow-lg shadow-green-100 hover:brightness-110 active:scale-[0.98] transition-all">
              Fill Meesho Form
            </button>
          </div>
        </motion.div>
        
        {/* Toast Mockup */}
        <motion.div 
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 1 }}
          className="absolute bottom-8 right-8 bg-[#333333] text-white px-5 py-3 rounded-xl text-xs font-medium flex items-center gap-3 shadow-2xl border border-white/10"
        >
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
          Ready to list your products!
        </motion.div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
      `}} />
    </div>
  );
}
