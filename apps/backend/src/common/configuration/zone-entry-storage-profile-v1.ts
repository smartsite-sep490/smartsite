/** Frozen physical-storage migration profile, qualified against fresh graph64.
 * Preserve this version; future SQL changes need a new migration/profile. */
export const ZONE_ENTRY_STORAGE_NAMES = {
  mf06_assessment_request: 'zone_entry_assessment_request',
  mf06_assessment_job: 'zone_entry_assessment_job',
  mf06_assessment: 'zone_entry_assessment',
  mf06_authority_artifact: 'zone_entry_authority_artifact',
  mf06_authority_source: 'authorization_history_source',
  mf06_authority_command: 'authorization_history_command',
  mf06_authority_fact: 'authorization_history_revision',
  mf06_authority_commit_witness: 'authorization_history_commit_receipt',
  mf06_authority_gap: 'authorization_history_gap',
  mf06_authority_head: 'authorization_history_head',
  mf06_authority_epoch: 'authorization_history_epoch',
  mf06_authority_control: 'authorization_history_control',
  mf06_authority_baseline: 'authorization_history_baseline',
  mf06_assignment_command_result: 'worker_assignment_command_receipt',
  mf06_participation_command_result: 'contractor_participation_command_receipt',
  mf06_zone_permission_command_result: 'zone_permission_command_receipt',
  mf06_zone_deny_command_result: 'zone_access_denial_command_receipt',
} as const;

export const ZONE_ENTRY_STORAGE_FUNCTIONS = [
  {
    name: 'mf06_assignment_result_guard',
    before: [
      '1d8020220bc0124e60c1d4eadafad54379a0b6505feb5477a03953e75009440b',
      '58c0312f9fdc7900f847a17e456a42192a9fc8ec9c0ebb8fbb5d10c7484eb1bd',
    ],
    after: [
      'a00cbaec51b06f2389bcd3402083ce82432f2658c9c7b4afab8452114c0ab181',
      '9176257e507a9c6c431af220f4c312d1b2d05cd7eaccb5bea6203741f7f72818',
    ],
    search_path: true,
    utc: true,
  },
  {
    name: 'mf06_authority_baseline_capture',
    before: [
      '84a33b02335cdfc0a017f61c256659fbf59925ebbb88f0703d2e6f6e09e1d745',
      'e8fc1add110ddb246bee496f4439afe5fe3568bc0f0f2a81235e6cf6aebb0777',
    ],
    after: [
      '63486609b1b7506deb72b09fdb87dfa9bd23431157448d4e3f4d979df16af0d3',
      '034e9804df052f6d6f5b8e462723fa1b07e8f98a329e9399dd37852d15de250a',
    ],
    search_path: true,
    utc: true,
  },
  {
    name: 'mf06_authority_baseline_link',
    before: [
      '310ffc0268bb6d253faa83c55856343734889785bc3aac1427d1da96662f1920',
      '079fb4e180c1e7b67fb0ca6459496aa568547c564d94e02ba372197aa11baa50',
    ],
    after: [
      '54f85d0fc579e47ad6ca3781c473c607b3becc091e55d1f62557db1eb358338a',
      '4f12ef1b6beffd20f273d45718362b7cb25780782d0fe6afa327b3a6048ce459',
    ],
    search_path: true,
    utc: false,
  },
  {
    name: 'mf06_authority_epoch_guard',
    before: [
      '9287531542e096f47e5bde6af65fa7a4534a33fbc63cc7a48c4886dff4a70a35',
      'e3b22dd3bdd4f957c3dd6b7d61d94f328b776c2d969c2f9a3ca825ceada9eb75',
    ],
    after: [
      'bfcd8f4ce91a4e5c7cbe1b5b3ac67fc81c723c7ca45348e32b3dddf0fe7a5249',
      'e7ef5d48e7d43b8f2bae7d6ab675fa0d10d0821ded4b0be9601b62c6752b1d59',
    ],
    search_path: false,
    utc: false,
  },
  {
    name: 'mf06_authority_internal_guard',
    before: [
      'b109f71d4f404298deea3f8ae31c9a93be3aab6a236fe97e9ba13569b2222c15',
      'e67829388621c63bc7b51c0196ced195aae4b1b52e238eee620e2792649738ac',
    ],
    after: [
      'e51df6d210b9ada2802c528d6474c8496063d3efa18837d4d7b74475401e5f7f',
      '158bb4e6666dba2f7f0bb35804e460e9ddd4255724c982458196323bef885fa0',
    ],
    search_path: false,
    utc: false,
  },
  {
    name: 'mf06_authority_witness_guard',
    before: [
      '0bbc1b11512acccd53aaf047fbe83282a62f1cc6880440740d92aed6ae1d5774',
      '216fe4e9619273fb6286b29d1d5c3305710102d138420415b8b93055a7ab8f12',
    ],
    after: [
      '4af9213d3a709fa433e7ad4464f1172abb821250b02b9851cb2e09d7e1c6b325',
      '7ea7dd3857da88b2fe190891dcf949e63b73239508941562c234baadfcc59b7b',
    ],
    search_path: true,
    utc: false,
  },
  {
    name: 'mf06_b2_artifact_attachment_guard',
    before: [
      '60ccb7d6880ea2724f5dc4d2de670aad24dcf952dd4b5b91fb2155ee826c342f',
      '1f636c39ab072098c0905be6a130291ae9adbdf0e0e89b529afc060b3f8633a0',
    ],
    after: [
      '70b2d4d22459f9dc9f77ac4ba29e3651266c86a8bb3a8b02ddfd20ce1cd912f0',
      '2dbbfd2c0e252fdb0d57aee5bc8191ecd3725110479dd70fe709c78cf71bab3e',
    ],
    search_path: false,
    utc: false,
  },
  {
    name: 'mf06_b2_artifact_insert_guard',
    before: [
      'a4f6f22ef5819a376524976606ee2e906c7a5a4fcaff1312f6446ec1d4eb7929',
      '90ebf482848cf9376e18e0062d44879e11ab77272b337f4e93b2799ffbb79461',
    ],
    after: [
      '86cfb5eaadbd1a9a7bc8bf3462e71c44c6b7eca061e4aa52a352a19bbe087d9e',
      '7b40b4c3694bf4e962bdd29384dc878171638b951fe2a5101b1e7cf2aea44d89',
    ],
    search_path: false,
    utc: false,
  },
  {
    name: 'mf06_b2_assessment_insert_guard',
    before: [
      'd93e0b3fe58ee7a2a854e20eef327c11794090271f68f98963e3d1ee073d5fb3',
      'cda198fa5e7b8893f75409a992dbe40f6f1a6501e70c2f2407987ba130ffb80f',
    ],
    after: [
      'ea9880aebd800eb1d36f2b36036e2310ba7b4785a5ef0bc92e47f2b4e92bff50',
      '7dff8a262453df453500198f508688e73a31bb12983f38370613af477e2747d3',
    ],
    search_path: false,
    utc: false,
  },
  {
    name: 'mf06_b2_finalize_job',
    before: [
      '475139f619f4c13794ee85fcf600c6e4f1d84e828cb777593bdc93428db1088e',
      '66ee5d5372df45bbf54ad41fe69883f692caf1c6bb9c8c2d8011a9b84d0911e2',
    ],
    after: [
      '19fb38b3b5809f943c6646785cd5e88644850e261600bc27b024d77f1aaf173d',
      '1ec46b7b408160580094c7252f994851a5dbd64f627bd5e52d01a7b775628b4a',
    ],
    search_path: false,
    utc: false,
  },
  {
    name: 'mf06_b2_job_complete_guard',
    before: [
      '2dfe8a14836335228390b2db44f842a8128be0324cbd20b19edcf777c6eb7098',
      'fe5a8e0d2b39b8ad66ff8e87b09f5bb8459512a778f40c2162c3b1341eb1731d',
    ],
    after: [
      'fe742f21195a1b1e93d76ed18065a50d3c8415340c403cc469d307acd037d802',
      '3aed5809b26849b3fb35495dc3c8129176fafe935df4bc4e5ff9f7920bd4bd82',
    ],
    search_path: false,
    utc: false,
  },
  {
    name: 'mf06_capture_main_authority',
    before: [
      'ba5755f77648c96662a1926522af75b52218248b5920ddda36d1351d73512064',
      '70224523070309e90ab796d43d7fa432812a54d70863c75ed7586db8c390b913',
    ],
    after: [
      '9a2f2c8047a1bb02dbfc89f0d972e1ee7de1939e7759aec7e31dc85bab425dfd',
      '6c17d913ed79d7006d82f527c5a91f2f8929ccb260847a33fd5fc6b863a267a5',
    ],
    search_path: true,
    utc: true,
  },
  {
    name: 'mf06_participation_result_guard',
    before: [
      '0afc76b220d01e434a4f56df09f6ea1d8b71923ac21e3ee2de8f5d62f59fe89d',
      '8643cfad919b341d58317f09d97e9fc8d6b2eb020f150ae58fc0d38bfae74ead',
    ],
    after: [
      '66f0e6fcebd770d189e4b256441b0ccaab7ca8c4cee6ac6e2661a279c9af4735',
      '372d894fc7fe997ff2572409b577650842ecb9bc48590d76ff5b0d31e1d1e458',
    ],
    search_path: true,
    utc: true,
  },
  {
    name: 'mf06_request_parent_guard',
    before: [
      '972898fae74b34a288f5a15f2ecb939cedfeac993f2ae45d803d719888d90afd',
      '52b2a88553aac81878c9b22cc54e212f4d33eedac90bfd76af203a7ede28d99b',
    ],
    after: [
      'e053c9d3bfea24ce56b1234b20c7ab6d63ba27549b8576889ac0f9c20af7ab00',
      '0589ca87514ec2426796687a3ae36f507fcdb995e776327605afe999fad3747e',
    ],
    search_path: false,
    utc: false,
  },
  {
    name: 'mf06_zone_deny_result_guard',
    before: [
      '1df0d55980461847efbd1e3247ec6383d74865e5a646dec9feb9817c6640dcc4',
      'cebf673949ac738974b49bf098dc1a45de9a93603e390bd3c26b826301b39a1c',
    ],
    after: [
      '6006bd96effa8e20555efdfb961d26d0eb8d17b9aead9807ec07ca97fbdb4c3e',
      'c059cb5d1c84dead0e83a29f52330bc63509ae5b5c5146e6fecb7f888c5f87ee',
    ],
    search_path: true,
    utc: true,
  },
  {
    name: 'mf06_zone_permission_result_guard',
    before: [
      'd3dfd268a74c0b7f93d680bb8849f0315e563671a2237f8d28ac8f2d2971500c',
      'd8b5c5cf59de207521e5343e4b3e5821516fe0eb98c942698377f5e621d2c992',
    ],
    after: [
      '3b37186af8f7b4e32872e7255d1f6c1b6f513b0a091fa8fc4c0592184280a3fb',
      '0939d9505ce349983ef8b0dd1eb052d9d6c827c7e5cc94e4a1a2bb1e49aa1dfe',
    ],
    search_path: true,
    utc: true,
  },
];
